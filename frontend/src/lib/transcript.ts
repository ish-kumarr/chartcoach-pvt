export type TranscriptCue = { id: string; start: number; end: number; text: string };

function seconds(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

/** Parse timed SRT/WebVTT cues. Text is rendered as React text, never HTML. */
export function parseTranscript(source: string, duration = Infinity): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const block of source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const match = /^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})/.exec(lines[index]);
    if (!match) continue;
    const start = seconds(match[1]), end = Math.min(seconds(match[2]), duration);
    const text = lines.slice(index + 1).join(" ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
    if (Number.isFinite(start) && end > start && start < duration && text) cues.push({ id: `cue-${cues.length}`, start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function activeCueAt(cues: TranscriptCue[], time: number): TranscriptCue | undefined {
  return cues.findLast((cue) => time >= cue.start && time < cue.end);
}

export const transcriptTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
