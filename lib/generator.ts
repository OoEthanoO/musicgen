import { CrossfadePlayer } from "./audioEngine";

// ── RISKY PART #2b: the generate-ahead loop ──────────────────────────────────
// Keeps the player's queue topped up to `targetQueue` clips. Each new chunk is
// conditioned on the PREVIOUS one (lastChunk data URI) so the music evolves.
// NOTE: because chunk N+1 needs chunk N's audio, generation is inherently
// SEQUENTIAL — you can't parallelize the chain. Build runway with longer chunks,
// not with concurrency.

export type GenStatus = { generating: boolean; queue: number; error?: string; backend?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MusicGenerator {
  player: CrossfadePlayer;
  prompt: string;
  seconds: number;

  onStatus?: (s: GenStatus) => void;
  onPromptUsed?: (p: string) => void;

  private lastChunk: string | null = null; // data URI of previous chunk = continuation seed
  private running = false;
  private targetQueue: number;
  private step = 0; // absolute chunk index — drives synth continuity / progression

  constructor(
    player: CrossfadePlayer,
    opts: { prompt: string; seconds?: number; targetQueue?: number }
  ) {
    this.player = player;
    this.prompt = opts.prompt;
    this.seconds = opts.seconds ?? 8;
    this.targetQueue = opts.targetQueue ?? 3;
  }

  setPrompt(p: string) {
    this.prompt = p;
  }

  /** Break the continuation chain so the next chunk starts fresh (e.g. big vibe change). */
  reseed() {
    this.lastChunk = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      if (this.player.queueLength >= this.targetQueue) {
        await sleep(150);
        continue;
      }
      const promptUsed = this.prompt;
      try {
        this.onStatus?.({ generating: true, queue: this.player.queueLength });

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: promptUsed,
            initAudio: this.lastChunk,
            seconds: this.seconds,
            step: this.step,
          }),
        });
        if (!res.ok) throw new Error(`gen ${res.status}: ${await res.text()}`);

        const { audioDataUri, backend } = await res.json();
        const arr = await (await fetch(audioDataUri)).arrayBuffer();
        const buf = await this.player.ctx.decodeAudioData(arr);

        if (!this.running) break;
        this.player.enqueue(buf);
        this.lastChunk = audioDataUri; // seed the next chunk with this one
        this.step++;
        this.onPromptUsed?.(promptUsed);
        this.onStatus?.({ generating: false, queue: this.player.queueLength, backend });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.onStatus?.({ generating: false, queue: this.player.queueLength, error: msg });
        await sleep(1000); // back off, then retry the chain
      }
    }
  }
}
