export const DEFAULT_PROMPT = "warm lo-fi hip hop, mellow, vinyl crackle, 75 bpm";

export type Instrument = { id: string; label: string; tag: string };

// "Instruments" are prompt tags, not real stems. Toggling injects/removes phrases.
export const INSTRUMENTS: Instrument[] = [
  { id: "bass", label: "🔊 Bass", tag: "driving bassline" },
  { id: "drums", label: "🥁 Drums", tag: "punchy drums" },
  { id: "keys", label: "🎹 Keys", tag: "warm electric piano" },
  { id: "synth", label: "🎛️ Synth", tag: "shimmering synth pads" },
  { id: "guitar", label: "🎸 Guitar", tag: "clean electric guitar" },
  { id: "strings", label: "🎻 Strings", tag: "lush string section" },
];

export function buildPrompt(base: string, active: Set<string>): string {
  const tags = INSTRUMENTS.filter((i) => active.has(i.id)).map((i) => i.tag);
  return [base.trim(), ...tags].filter(Boolean).join(", ");
}
