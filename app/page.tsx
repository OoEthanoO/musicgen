"use client";

import { useEffect, useRef, useState } from "react";
import { CrossfadePlayer } from "@/lib/audioEngine";
import { MusicGenerator, type GenStatus } from "@/lib/generator";
import { FallbackGenerator, MOODS } from "@/lib/fallback";
import { INSTRUMENTS, DEFAULT_PROMPT, buildPrompt } from "@/lib/prompt";

const CHUNK_SECONDS = 8; // ⚠️ tune this. 2s won't keep up with Replicate latency; 8s buys runway.
const TARGET_QUEUE = 3;

export default function Home() {
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [playing, setPlaying] = useState(false);
  const [base, setBase] = useState(DEFAULT_PROMPT);
  const [active, setActive] = useState<Set<string>>(new Set(["drums", "bass"]));
  const [mood, setMood] = useState("chill");

  const [status, setStatus] = useState<GenStatus>({ generating: false, queue: 0 });
  const [queueLen, setQueueLen] = useState(0);
  const [usedPrompt, setUsedPrompt] = useState("");

  const playerRef = useRef<CrossfadePlayer | null>(null);
  const liveRef = useRef<MusicGenerator | null>(null);
  const demoRef = useRef<FallbackGenerator | null>(null);

  const effectivePrompt = buildPrompt(base, active);

  // Push prompt changes to the live generator (debounced) so typing/toggling steers the NEXT chunk.
  useEffect(() => {
    if (mode !== "live") return;
    const id = setTimeout(() => liveRef.current?.setPrompt(effectivePrompt), 300);
    return () => clearTimeout(id);
  }, [effectivePrompt, mode]);

  useEffect(() => {
    if (mode === "demo") demoRef.current?.setMood(mood);
  }, [mood, mode]);

  function ensurePlayer(): CrossfadePlayer {
    if (!playerRef.current) {
      const p = new CrossfadePlayer();
      p.onQueue = (n) => setQueueLen(n);
      p.onStarved = () => setStatus((s) => ({ ...s, error: "buffer empty — falling behind" }));
      playerRef.current = p;
    }
    return playerRef.current;
  }

  async function play() {
    const player = ensurePlayer();
    await player.start();

    if (mode === "live") {
      const gen = new MusicGenerator(player, {
        prompt: effectivePrompt,
        seconds: CHUNK_SECONDS,
        targetQueue: TARGET_QUEUE,
      });
      gen.onStatus = setStatus;
      gen.onPromptUsed = setUsedPrompt;
      liveRef.current = gen;
      gen.start();
    } else {
      const fb = new FallbackGenerator(player, mood, TARGET_QUEUE);
      fb.onStatus = setStatus;
      demoRef.current = fb;
      fb.start();
    }
    setPlaying(true);
  }

  function stop() {
    liveRef.current?.stop();
    demoRef.current?.stop();
    liveRef.current = null;
    demoRef.current = null;
    playerRef.current?.stop();
    playerRef.current?.clear();
    setPlaying(false);
    setStatus({ generating: false, queue: 0 });
  }

  function toggleInstrument(id: string) {
    setActive((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const genDot = status.error ? "warn" : status.generating ? "gen" : playing ? "live" : "";

  return (
    <div className="wrap">
      <h1>🎧 Steerable MusicGen</h1>
      <p className="sub">
        Continuous AI music, generated {CHUNK_SECONDS}s at a time — each chunk continues the last. Steer it live.
      </p>

      {/* Mode + transport */}
      <div className="panel">
        <div className="row">
          <div className="mode-toggle">
            <button
              className={`ghost ${mode === "live" ? "active" : ""}`}
              onClick={() => !playing && setMode("live")}
              disabled={playing}
            >
              ⚡ Live
            </button>
            <button
              className={`ghost ${mode === "demo" ? "active" : ""}`}
              onClick={() => !playing && setMode("demo")}
              disabled={playing}
            >
              🛟 Demo
            </button>
          </div>
          <div className="spacer" />
          {!playing ? (
            <button className="primary" onClick={play}>
              ▶ Play
            </button>
          ) : (
            <button className="primary stop" onClick={stop}>
              ■ Stop
            </button>
          )}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <div className="status">
            <span className={`dot ${genDot}`} />
            <span>
              {status.error
                ? status.error
                : status.generating
                ? "generating next chunk…"
                : playing
                ? "playing"
                : "stopped"}
            </span>
          </div>
          <div className="spacer" />
          <div className="queue" title="generate-ahead buffer">
            {Array.from({ length: TARGET_QUEUE }).map((_, i) => (
              <span key={i} className={`qslot ${i < queueLen ? "full" : ""}`} />
            ))}
          </div>
        </div>
        {mode === "live" && (
          <p className="hint">
            First chunk can take 10–30s (model cold start). Buffer fills, then it stays ahead.
          </p>
        )}
      </div>

      {/* Prompt steering */}
      <div className="panel">
        <label className="field-label">Prompt — steers the next generation</label>
        <textarea
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="describe the music…"
        />
        {mode === "live" && usedPrompt && <div className="used">last sent: “{usedPrompt}”</div>}
      </div>

      {/* Instrument toggles (live) or mood picker (demo) */}
      {mode === "live" ? (
        <div className="panel">
          <label className="field-label">Instruments — toggle to add/remove prompt tags</label>
          <div className="chips">
            {INSTRUMENTS.map((ins) => (
              <span
                key={ins.id}
                className={`chip ${active.has(ins.id) ? "on" : ""}`}
                onClick={() => toggleInstrument(ins.id)}
              >
                {ins.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="panel">
          <label className="field-label">Mood — swaps between pre-generated clips</label>
          <div className="chips">
            {Object.keys(MOODS).map((m) => (
              <span key={m} className={`chip ${mood === m ? "on" : ""}`} onClick={() => setMood(m)}>
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
