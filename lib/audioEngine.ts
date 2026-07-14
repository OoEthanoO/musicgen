// ── RISKY PART #2a: the Web Audio buffer + crossfade playback loop ───────────
// A gapless player. You enqueue() decoded AudioBuffers; a lookahead ticker
// schedules each one to start just as the previous one's tail fades out, with a
// short equal-power-ish crossfade over the seam. If the queue runs dry it
// resyncs cleanly (brief silence, no click) and fires onStarved so the UI can
// show "buffering" and the generator knows it's falling behind.

export class CrossfadePlayer {
  ctx: AudioContext;
  master: GainNode;
  xfade = 0.2; // crossfade seconds — the overlap between consecutive clips
  scheduleAhead = 1.0; // how far ahead (s) we're willing to schedule a clip
  volume = 0.9;

  onStarved?: () => void;
  onQueue?: (len: number) => void;

  private queue: AudioBuffer[] = [];
  private nextStartTime = 0; // ctx time at which the next clip should begin
  private prevGain: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private starved = false;

  constructor(ctx?: AudioContext) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = ctx ?? new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  async start() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    if (this.started) return;
    this.started = true;
    this.starved = false;
    this.prevGain = null;
    this.nextStartTime = this.ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.tick(), 200);
  }

  stop() {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // soft mute; scheduled sources are left to finish under a silenced master
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + 0.12);
  }

  setVolume(v: number) {
    this.volume = v;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  enqueue(buf: AudioBuffer) {
    this.queue.push(buf);
    this.onQueue?.(this.queue.length);
  }

  clear() {
    this.queue = [];
    this.onQueue?.(0);
  }

  get queueLength() {
    return this.queue.length;
  }

  private tick() {
    if (!this.started) return;
    const now = this.ctx.currentTime;

    // Ran dry: resync so the next clip starts clean instead of in the past.
    if (this.queue.length === 0 && now >= this.nextStartTime) {
      if (!this.starved) {
        this.starved = true;
        this.onStarved?.();
      }
      this.prevGain = null; // next clip = fresh start, no dangling crossfade
      this.nextStartTime = now + 0.1;
      return;
    }
    if (this.queue.length > 0) this.starved = false;

    while (this.queue.length > 0 && this.nextStartTime < now + this.scheduleAhead) {
      this.scheduleClip(this.queue.shift()!);
    }
    this.onQueue?.(this.queue.length);
  }

  private scheduleClip(buf: AudioBuffer) {
    const now = this.ctx.currentTime;
    const start = Math.max(this.nextStartTime, now + 0.02);
    const xf = Math.min(this.xfade, buf.duration / 2);

    const g = this.ctx.createGain();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g).connect(this.master);

    if (this.prevGain === null) {
      g.gain.setValueAtTime(1, start);
    } else {
      // fade THIS clip in
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(1, start + xf);
      // fade the PREVIOUS clip out over the same overlap window
      const pg = this.prevGain;
      pg.gain.cancelScheduledValues(start);
      pg.gain.setValueAtTime(1, start);
      pg.gain.exponentialRampToValueAtTime(0.0001, start + xf);
    }

    src.start(start);
    src.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* already gone */
      }
    };

    this.prevGain = g;
    this.nextStartTime = start + buf.duration - xf; // overlap the next one by xf
  }
}
