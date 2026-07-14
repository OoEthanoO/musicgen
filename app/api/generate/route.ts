import Replicate from "replicate";
import { synthesizeWav } from "@/lib/synth";

// ── RISKY PART #1: the generation serverless call ────────────────────────────
// Two backends behind ONE interface:
//   • no REPLICATE_API_TOKEN  -> local procedural synth (keyless, instant)
//   • token present           -> real MusicGen continuation on Replicate
// The client can't tell the difference; both return { audioDataUri, seconds }.

export const runtime = "nodejs";
export const maxDuration = 60; // seconds. Vercel Hobby caps at 60. MusicGen needs it.

const MODEL = "meta/musicgen";
// "melody-large" = mono, continuation + melody. "large" = fastest. "stereo-*" = slower/prettier.
const MODEL_VERSION = "melody-large";

export async function POST(req: Request) {
  try {
    const { prompt, initAudio, seconds = 8, step = 0 } = await req.json();
    const dur = Math.max(2, Math.min(15, Number(seconds) || 8));

    // ── Keyless path: synthesize locally ────────────────────────────────────
    const useSynth = !process.env.REPLICATE_API_TOKEN || process.env.MUSIC_BACKEND === "synth";
    if (useSynth) {
      const wav = synthesizeWav({ prompt: String(prompt || ""), seconds: dur, step: Number(step) || 0 });
      const audioDataUri = `data:audio/wav;base64,${wav.toString("base64")}`;
      return Response.json({ audioDataUri, seconds: dur, backend: "synth" });
    }

    // ── Real path: MusicGen on Replicate ────────────────────────────────────
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const input: Record<string, unknown> = {
      prompt: (prompt && String(prompt).trim()) || "ambient electronic music",
      model_version: MODEL_VERSION,
      duration: dur,
      output_format: "mp3",
      normalization_strategy: "peak",
      temperature: 1.0,
    };
    if (initAudio) {
      input.input_audio = initAudio; // Replicate accepts a data: URI directly
      input.continuation = true;
      // If chunks replay the seed, set input.continuation_start to trim. Verify live.
    }

    const prediction = await replicate.predictions.create({ model: MODEL, input });
    const done = await replicate.wait(prediction, { interval: 500 });
    if (done.status !== "succeeded") {
      return Response.json({ error: `prediction ${done.status}`, detail: done.error }, { status: 502 });
    }

    const url = Array.isArray(done.output) ? done.output[0] : done.output;
    if (!url) return Response.json({ error: "no output from model" }, { status: 502 });

    const audio = await fetch(url as string);
    const bytes = Buffer.from(await audio.arrayBuffer());
    const audioDataUri = `data:audio/mpeg;base64,${bytes.toString("base64")}`;
    return Response.json({ audioDataUri, seconds: dur, backend: "replicate" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
