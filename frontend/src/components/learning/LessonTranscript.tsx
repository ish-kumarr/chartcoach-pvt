"use client";
import { useEffect, useRef, useState } from "react";
import { activeCueAt, parseTranscript, transcriptTime, type TranscriptCue } from "@/lib/transcript";
import styles from "./lesson-study.module.css";

export default function LessonTranscript({ url, duration, position, language, onSeek, disabled }: {
  url: string; duration: number; position: number; language: string; onSeek: (seconds: number) => void; disabled: boolean;
}) {
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(url, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Transcript unavailable");
      const parsed = parseTranscript(await response.text(), duration);
      if (!parsed.length) throw new Error("No timed captions");
      if (!abort.signal.aborted) { setCues(parsed); setError(false); setLoaded(true); }
    }).catch(() => { if (!abort.signal.aborted) { setError(true); setLoaded(true); } });
    return () => abort.abort();
  }, [url, duration, retry]);
  const active = activeCueAt(cues, position);
  useEffect(() => {
    if (!follow || search) return;
    const region = list.current;
    const line = region?.querySelector<HTMLElement>('[aria-current="true"]');
    if (region && line) region.scrollTo?.({ top: line.offsetTop - region.clientHeight / 2 + line.clientHeight / 2, behavior: "instant" });
  }, [active?.id, follow, search]);
  const filtered = cues.filter((cue) => cue.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section data-tour-target="transcript" className={styles.transcript} aria-label="Interactive transcript" inert={disabled}>
    <header className={styles.panelHeader}>
      <div><h2>Transcript</h2><p>{language} · Synced to video</p></div>
      <button type="button" aria-pressed={follow} onClick={() => { setSearch(""); setFollow(!follow); }}>{follow ? "Following video" : "Follow video"}</button>
    </header>
    <input className={styles.search} aria-label="Search transcript" placeholder="Find a word or phrase…" value={search} onChange={(event) => setSearch(event.target.value)} />
    {error ? <p role="alert">Transcript unavailable. <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry transcript</button></p> : !loaded ? <p role="status">Loading transcript…</p> : <>
      <p className={styles.small}>{search ? `${filtered.length} matching lines` : "Select a line to jump to that moment."}</p>
      <div ref={list} className={styles.cueList} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
        {filtered.map((cue) => <button key={cue.id} type="button" className={styles.cue} aria-current={active?.id === cue.id ? "true" : undefined} onClick={() => onSeek(cue.start)}>
          <time>{transcriptTime(cue.start)}</time><span>{cue.text}</span>
        </button>)}
        {!filtered.length && <p>No matching lines.</p>}
      </div>
    </>}
  </section>;
}
