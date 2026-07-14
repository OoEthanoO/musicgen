import { CrossfadePlayer } from "./audioEngine";

// ── THE SAFETY NET ───────────────────────────────────────────────────────────
// If live generation is too slow on the day, flip to Demo mode. This feeds
// pre-generated per-mood clips into the SAME crossfade player, round-robin, so
// the demo looks identical — controls just swap moods instead of steering a model.
//
// Drop real clips into /public/moods/ and list them here. See public/moods/README.

export const MOODS: Record<string, string[]> = {
  chill: ["/moods/chill-1.mp3", "/moods/chill-2.mp3", "/moods/chill-3.mp3"],
  intense: ["/moods/intense-1.mp3", "/moods/intense-2.mp3", "/moods/intense-3.mp3"],
  dreamy: ["/moods/dreamy-1.mp3", "/moods/dreamy-2.mp3", "/moods/dreamy-3.mp3"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FallbackGenerator {
  player: CrossfadePlayer;
  mood: string;
  onStatus?: (s: { generating: boolean; queue: number; error?: string }) => void;

  private idx = 0;
  private running = false;
  private targetQueue: number;
  private cache = new Map<string, AudioBuffer>();

  constructor(player: CrossfadePlayer, mood = "chill", targetQueue = 3) {
    this.player = player;
    this.mood = mood in MOODS ? mood : "chill";
    this.targetQueue = targetQueue;
  }

  setMood(m: string) {
    if (m in MOODS) {
      this.mood = m;
      this.idx = 0;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private async load(url: string): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const arr = await (await fetch(url)).arrayBuffer();
    const buf = await this.player.ctx.decodeAudioData(arr);
    this.cache.set(url, buf);
    return buf;
  }

  private async loop() {
    while (this.running) {
      if (this.player.queueLength >= this.targetQueue) {
        await sleep(150);
        continue;
      }
      const list = MOODS[this.mood];
      const url = list[this.idx % list.length];
      try {
        this.onStatus?.({ generating: true, queue: this.player.queueLength });
        const buf = await this.load(url);
        if (!this.running) break;
        this.player.enqueue(buf);
        this.idx++;
        this.onStatus?.({ generating: false, queue: this.player.queueLength });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.onStatus?.({ generating: false, queue: this.player.queueLength, error: `missing ${url}? ${msg}` });
        this.idx++; // skip the bad file so one missing clip doesn't wedge the loop
        await sleep(500);
      }
    }
  }
}
