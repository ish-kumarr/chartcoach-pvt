"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import LessonTranscript from "./LessonTranscript";
import LessonChat from "./LessonChat";
import LessonTour from "./LessonTour";
import * as learningApi from "@/lib/learning-api";
import type {
  LessonMetadata,
  PlaybackAuthorization,
  LessonSegment,
} from "@/lib/learning-api";
import {
  createPlayerAdapter,
  type PlayerAdapterFactory,
} from "@/lib/player-adapter";
import {
  LessonController,
  type LessonApi,
  type LessonView,
} from "@/lib/lesson-controller";
import styles from "./lesson-player.module.css";
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Props = {
  lesson: LessonMetadata;
  authorization: PlaybackAuthorization;
  factory?: PlayerAdapterFactory;
  api?: LessonApi;
  onUnauthorized: () => void;
  onRetry?: () => void;
  previewMode?: boolean;
  tourStorageKey?: string;
};
export default function LessonPlayer({
  lesson,
  authorization,
  factory = createPlayerAdapter,
  api = learningApi,
  onUnauthorized,
  onRetry,
  previewMode = false,
  tourStorageKey,
}: Props) {
  const video = useRef<HTMLVideoElement>(null),
    playerSurface = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDivElement>(null),
    play = useRef<HTMLButtonElement>(null);
  const controller = useRef<LessonController | null>(null);
  const seekTo = useCallback((seconds: number) => controller.current?.seek(seconds), []);
  const [view, setView] = useState<LessonView | null>(null);
  const [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState<LessonSegment | null>(null),
    [speedNotice, setSpeedNotice] = useState(false),
    [tourRequest, setTourRequest] = useState(0);
  useEffect(() => {
    const element = video.current!;
    const instance = new LessonController(
      lesson,
      authorization,
      factory(element),
      api,
      setView,
      onUnauthorized,
    );
    controller.current = instance;
    void instance.start();
    return () => {
      instance.destroy();
      controller.current = null;
    };
  }, [lesson, authorization, factory, api, onUnauthorized]);
  const prompt = view?.prompt;
  const warning = view?.seekWarning;
  const seekNotice = view?.seekNotice;
  const seekBlocked = view?.seekBlocked;
  const modalOpen = Boolean(prompt || warning);
  useEffect(() => {
    if (!seekNotice) return;
    const timeout = window.setTimeout(
      () => controller.current?.dismissSeekNotice(seekNotice),
      4500,
    );
    return () => window.clearTimeout(timeout);
  }, [seekNotice]);
  useEffect(() => {
    if (!seekBlocked) return;
    const timeout = window.setTimeout(() => controller.current?.dismissSeekBlocked(), 4500);
    return () => window.clearTimeout(timeout);
  }, [seekBlocked]);
  useEffect(() => {
    if (!speedNotice) return;
    const timeout = window.setTimeout(() => setSpeedNotice(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [speedNotice]);
  useEffect(() => {
    if (prompt || warning) {
      dialog.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
    }
  }, [prompt, warning, view?.correct, view?.busy]);
  async function fullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setExpanded(false);
    } else if (expanded) setExpanded(false);
    else if (playerSurface.current?.requestFullscreen) {
      try {
        await playerSurface.current.requestFullscreen();
        setExpanded(true);
      } catch {
        setExpanded(true);
      }
    } else {
      const nativeVideo = video.current as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
      };
      if (nativeVideo?.webkitEnterFullscreen) nativeVideo.webkitEnterFullscreen();
      else setExpanded(true);
    }
  }
  useEffect(() => {
    const changed = () => {
      setExpanded(document.fullscreenElement === playerSurface.current);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest(
        "button,input,a,textarea,select,[contenteditable=true],[role=dialog]",
      ) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const key = event.key.toLowerCase(),
      c = controller.current,
      s = view?.snapshot;
    if (!c || !s) return;
    if ([" ", "k", "m", "c", "f", "arrowleft", "arrowright"].includes(key))
      event.preventDefault();
    if (key === " " || key === "k") void c.togglePlay();
    if (key === "m") c.setMuted(!s.muted);
    if (key === "c") c.setCaptions(!s.captionsEnabled);
    if (key === "f") void fullscreen();
    if (key === "arrowleft") c.seek(s.position - 5);
    if (key === "arrowright") c.seek(s.position + 5);
  }
  const s = view?.snapshot,
    position = s?.position ?? authorization.resume_position_seconds,
    seekableUntil = Math.min(
      lesson.duration_seconds,
      Math.max(position, view?.seekableUntil ?? position),
    );
  const active =
    lesson.segments.find(
      (segment) =>
        position >= segment.start_seconds && position < segment.end_seconds,
    ) ?? lesson.segments.at(-1);
  return (
    <div className={styles.workspace}>
      <div className={styles.mediaColumn}>
      <div
        ref={playerSurface}
        className={`${styles.player} ${expanded ? styles.playerExpanded : ""}`}
        data-tour-target="player"
        role="region"
        aria-label="Lesson video"
        tabIndex={0}
        onKeyDown={keyboard}
      >
        <header className={styles.brand}>
          <span>{lesson.title}</span>
          <span>ChartCoach</span>
        </header>
        <div className={styles.screen}>
          {previewMode && (
            <div className={styles.previewVisual} aria-hidden="true">
              <span>SIMULATED LESSON MEDIA</span>
              <strong>{active?.title}</strong>
              <small>Timeline and knowledge-check interactions are live in this preview.</small>
            </div>
          )}
          <video
            ref={video}
            aria-label="Lesson media"
            playsInline
            preload="metadata"
            poster={lesson.segments[0]?.thumbnail.url}
            controls={false}
            className={previewMode ? styles.previewVideo : undefined}
          />
          {(!view?.ready || s?.buffering) && (
            <p className={styles.loading} role="status">
              {s?.buffering ? "Buffering…" : "Preparing secure playback…"}
            </p>
          )}
        </div>
        <div className={styles.controls} inert={modalOpen}>
          <div className={styles.timeline} data-tour-target="seek">
            <input
              type="range"
              aria-label="Playback position"
              title="Seek within the part you have watched"
              min={0}
              max={lesson.duration_seconds}
              step={0.1}
              value={position}
              onChange={(e) => controller.current?.seek(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, #ff167d 0 ${(position / lesson.duration_seconds) * 100}%, #ffffffa8 ${(position / lesson.duration_seconds) * 100}% ${(seekableUntil / lesson.duration_seconds) * 100}%, #ffffff40 ${(seekableUntil / lesson.duration_seconds) * 100}% 100%)`,
              }}
            />
            <div className={styles.markers}>
              {lesson.segments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  aria-label={`Preview ${segment.title}`}
                  aria-current={active?.id === segment.id ? "true" : undefined}
                  style={{
                    left: `${(segment.start_seconds / lesson.duration_seconds) * 100}%`,
                  }}
                  onMouseEnter={() => setPreview(segment)}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => setPreview(segment)}
                  onBlur={() => setPreview(null)}
                  onClick={() =>
                    controller.current?.seek(segment.start_seconds)
                  }
                >
                  │
                </button>
              ))}
              {lesson.segments
                .filter(
                  (segment) =>
                    segment.required_prompt &&
                    !view?.progress.passed_prompt_ids.includes(
                      segment.required_prompt.id,
                    ),
                )
                .map((segment) => (
                  <span
                    key={segment.id}
                    className={styles.promptMarker}
                    style={{
                      left: `${(segment.end_seconds / lesson.duration_seconds) * 100}%`,
                    }}
                    title="Required knowledge check"
                    aria-label="Required knowledge check"
                  >
                    ◆
                  </span>
                ))}
            </div>
            {preview && (
              <div role="tooltip" className={styles.preview}>
                <Image
                  unoptimized
                  width={160}
                  height={90}
                  src={preview.thumbnail.url}
                  alt={`${preview.title} preview`}
                />
                <div>
                  <small>{time(preview.thumbnail.time_seconds)}</small>
                  <strong>{preview.title}</strong>
                  <p>{preview.description}</p>
                </div>
              </div>
            )}
          </div>
          <div className={styles.buttons}>
            <button
              ref={play}
              type="button"
              disabled={!view?.ready}
              onClick={() => void controller.current?.togglePlay()}
              aria-label={s?.paused !== false ? "Play" : "Pause"}
              data-tooltip={s?.paused !== false ? "Play (K / Space)" : "Pause (K / Space)"}
              aria-keyshortcuts="k Space"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{s?.paused !== false ? <path d="M7 3.5v17l14-8.5z" /> : <path d="M6 4h4v16H6zm8 0h4v16h-4z" />}</svg>
            </button>
            <button
              type="button"
              aria-label={s?.muted ? "Unmute" : "Mute"}
              data-tooltip={s?.muted ? "Unmute (M)" : "Mute (M)"}
              aria-keyshortcuts="m"
              onClick={() => controller.current?.setMuted(!s?.muted)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4 5 9H2v6h3l6 5z" fill="currentColor" stroke="none" />{s?.muted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 4a11 11 0 0 1 0 16" /></>}</svg>
            </button>
            <input
              type="range"
              aria-label="Volume"
              title="Volume"
              min={0}
              max={1}
              step={0.05}
              value={s?.volume ?? 1}
              onChange={(e) =>
                controller.current?.setVolume(Number(e.target.value))
              }
            />
            <span className={styles.clock}>
              {time(position)} / {time(lesson.duration_seconds)}
            </span>
            <select className={styles.speed} aria-label="Playback speed" title="Playback speed" value={s?.playbackRate ?? 1} disabled={!view?.ready} onChange={(event) => { const rate = Number(event.target.value); controller.current?.setPlaybackRate(rate); setSpeedNotice(rate >= 1.75); }}>
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
            <button
              type="button"
              aria-label={`${lesson.captions.label} captions`}
              data-tooltip={`${lesson.captions.label} captions (C)`}
              aria-keyshortcuts="c"
              aria-pressed={s?.captionsEnabled ?? false}
              disabled={!s?.captionsAvailable}
              onClick={() =>
                controller.current?.setCaptions(!s?.captionsEnabled)
              }
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M10 9H7v6h3m9-6h-3v6h3" /></svg>
            </button>
            {tourStorageKey && (
              <button
                type="button"
                aria-label="Open player tutorial"
                data-tooltip="Player tutorial"
                onClick={() => setTourRequest((request) => request + 1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.8 1.3-1.8 2.7M12 17h.01" /></svg>
              </button>
            )}
            <button
              type="button"
              aria-label={expanded ? "Exit fullscreen" : "Expand player"}
              data-tooltip={expanded ? "Exit fullscreen (F)" : "Fullscreen (F)"}
              aria-keyshortcuts="f"
              onClick={() => void fullscreen()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">{expanded ? <path d="M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" /> : <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />}</svg>
            </button>
          </div>
        </div>
        {view?.error && !prompt && (
          <div role="alert" className={styles.error}>
            {view.error}{" "}
            <button type="button" onClick={onRetry}>
              Retry playback
            </button>
          </div>
        )}
      </div>
      <LessonTranscript key={lesson.id} url={lesson.captions.url} duration={lesson.duration_seconds} position={position} language={lesson.captions.label} onSeek={seekTo} disabled={modalOpen || !view?.ready} />
      </div>
      <div className={styles.studySidebar} inert={modalOpen}>
      <LessonChat key={lesson.id} lessonId={lesson.id} position={position} onSeek={seekTo} />
      <aside
        className={styles.chapters}
        aria-label="Lesson chapters"
        inert={modalOpen}
      >
        <p className={styles.eyebrow}>YOUR LEARNING PATH</p>
        <h2>In this lesson</h2>
        <ol>
          {lesson.segments.map((segment, index) => (
            <li key={segment.id}>
              <button
                type="button"
                aria-label={`Chapter ${index + 1}: ${segment.title}`}
                aria-current={active?.id === segment.id ? "true" : undefined}
                onClick={() => controller.current?.seek(segment.start_seconds)}
              >
                <Image
                  unoptimized
                  width={96}
                  height={54}
                  src={segment.thumbnail.url}
                  alt=""
                />
                <span>
                  <small>
                    {String(index + 1).padStart(2, "0")} ·{" "}
                    {time(segment.start_seconds)}
                  </small>
                  <strong>{segment.title}</strong>
                  <span>{segment.description}</span>
                  {segment.required_prompt && (
                    <small>
                      Knowledge check{" "}
                      {view?.progress.passed_prompt_ids.includes(
                        segment.required_prompt.id,
                      )
                        ? "✓"
                        : "◆"}
                    </small>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p data-tour-target="progress" className={styles.progress} aria-live="polite">
          {view?.progress.completed
            ? "Lesson complete"
            : `${Math.round(view?.progress.watch_percent ?? 0)}% watched · Progress saved as you learn`}
        </p>
      </aside>
      </div>
      {tourStorageKey && <LessonTour storageKey={tourStorageKey} openRequest={tourRequest} />}
      {seekBlocked && !modalOpen && (
        <div className={styles.seekNotice} role="status" aria-label="Forward seeking unavailable">
          <div><strong>This section is not unlocked yet</strong></div>
          <p>You can seek forward through video you have already watched. Watch this section naturally first so progress and required questions stay accurate.</p>
          <button type="button" aria-label="Dismiss forward seeking notice" onClick={() => controller.current?.dismissSeekBlocked()}>×</button>
        </div>
      )}
      {speedNotice && !modalOpen && (
        <div className={styles.seekNotice} role="status" aria-label="Playback speed reminder">
          <div><strong>Fast playback reminder</strong></div>
          <p>At 1.75× or 2×, this may make it harder to absorb the lesson and retain key ideas.</p>
          <button type="button" aria-label="Dismiss playback speed reminder" onClick={() => setSpeedNotice(false)}>×</button>
        </div>
      )}
      {seekNotice && !modalOpen && (
        <div className={styles.seekNotice} role="status" aria-label="Skip reminder">
          <div>
            <strong>Quick learning reminder</strong>
            <span>Reminder {seekNotice} of 3</span>
          </div>
          <p>Skipped sections won’t count toward your watched progress. You can keep watching or go back whenever you’re ready.</p>
          <button type="button" aria-label="Dismiss reminder" onClick={() => controller.current?.dismissSeekNotice(seekNotice)}>×</button>
        </div>
      )}
      {warning && !prompt && (
        <div className={styles.dialogShade}>
          <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="seek-warning-title" aria-describedby="seek-warning-description" className={styles.dialog}
            onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); dialog.current?.querySelector("button")?.focus(); } }}>
            <p className={styles.eyebrow}>WATCHING REMINDER</p>
            <h2 id="seek-warning-title">Take a moment before skipping ahead</h2>
            <p id="seek-warning-description">You’ve skipped ahead several times or jumped over a large part of the lesson. Skipped sections don’t count toward your watched progress. You can go back to review them at any time.</p>
            <button type="button" onClick={() => { void controller.current?.acknowledgeSeekWarning(); play.current?.focus(); }}>Continue watching</button>
          </div>
        </div>
      )}
      {prompt && (
        <div className={styles.dialogShade}>
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="check-title"
            className={styles.dialog}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const buttons = Array.from(
                dialog.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) ?? [],
              );
              const first = buttons[0],
                last = buttons.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <p className={styles.eyebrow}>PAUSE & REFLECT</p>
            <h2 id="check-title">{prompt.question}</h2>
            <p>Answer this check to continue your lesson.</p>
            {view.error && (
              <div role="alert">
                <p>{view.error}</p>
                <button type="button" onClick={onRetry}>
                  Retry playback
                </button>
              </div>
            )}
            <div className={styles.options}>
              {prompt.options.map((option) => (
                <button
                  type="button"
                  disabled={view.busy || view.correct}
                  key={option.id}
                  onClick={() => void controller.current?.answer(option.id)}
                >
                  {option.text}
                </button>
              ))}
            </div>
            {view.feedback && (
              <p role="status" className={styles.feedback}>
                {view.feedback}
              </p>
            )}
            {view.correct && (
              <button
                type="button"
                onClick={() => {
                  void controller.current?.continue();
                  play.current?.focus();
                }}
              >
                Continue lesson
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
