import Replicate from "replicate";

// ── RISKY PART #1: the Replicate MusicGen serverless call ────────────────────
// Runs on Vercel as a Node serverless function. Blocks until the prediction is
// done, then proxies the audio back as a base64 data URI so the client gets
// (a) same-origin bytes it can decode with zero CORS drama, and
// (b) a reusable data URI to feed straight back in as the NEXT continuation seed.

export const runtime = "nodejs";
export const maxDuration = 60; // seconds. Vercel Hobby caps at 60. MusicGen needs it.

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const MODEL = "meta/musicgen";
// "melody-large"  -> mono, supports continuation + melody conditioning (default).
// "large"         -> mono, fastest continuation-only. Try this if latency hurts.
// "stereo-melody-large" -> stereo, ~2x slower. Only if you have runway to spare.
const MODEL_VERSION = "melody-large";

export async function POST(req: Request) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return Response.json({ error: "REPLICATE_API_TOKEN not set" }, { status: 500 });
    }

    const { prompt, initAudio, seconds = 8 } = await req.json();

    const input: Record<string, unknown> = {
      prompt: (prompt && String(prompt).trim()) || "ambient electronic music",
      model_version: MODEL_VERSION,
      duration: Math.max(2, Math.min(15, Number(seconds) || 8)),
      output_format: "mp3", // mp3 = ~10x smaller than wav over the wire. decodeAudioData handles it.
      normalization_strategy: "peak",
      temperature: 1.0,
    };

    // Continuation mode: seed the next chunk with the previous one so it EVOLVES.
    if (initAudio) {
      input.input_audio = initAudio; // Replicate accepts a data: URI directly.
      input.continuation = true;
      // If you notice each chunk replays the seed before continuing, the output
      // includes the seed — set input.continuation_start to trim it. Verify live.
    }

    const prediction = await replicate.predictions.create({ model: MODEL, input });
    const done = await replicate.wait(prediction, { interval: 500 });

    if (done.status !== "succeeded") {
      return Response.json(
        { error: `prediction ${done.status}`, detail: done.error },
        { status: 502 }
      );
    }

    const url = Array.isArray(done.output) ? done.output[0] : done.output;
    if (!url) return Response.json({ error: "no output from model" }, { status: 502 });

    const audio = await fetch(url as string);
    const bytes = Buffer.from(await audio.arrayBuffer());
    const audioDataUri = `data:audio/mpeg;base64,${bytes.toString("base64")}`;

    return Response.json({ audioDataUri, seconds: input.duration });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
