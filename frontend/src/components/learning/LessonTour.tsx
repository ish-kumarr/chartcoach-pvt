"use client";

import { useEffect, useMemo, useState } from "react";

type Props = { storageKey: string; openRequest?: number };
type Step = { target: string; eyebrow: string; title: string; body: string };

const steps: Step[] = [
  { target: "player", eyebrow: "THE PLAYER", title: "Meet your lesson player", body: "Play, pause, change speed, turn on captions, and use the timeline to review what you have watched." },
  { target: "seek", eyebrow: "WATCHED RANGE", title: "Your watched range", body: "The timeline unlocks as you watch. You can revisit any unlocked moment, while unseen sections stay protected so questions and progress remain meaningful." },
  { target: "transcript", eyebrow: "INTERACTIVE TRANSCRIPT", title: "Follow along with the transcript", body: "The current line follows the video. Select any line to jump back to that moment, or search for a phrase." },
  { target: "chat", eyebrow: "YOUR LESSON COACH", title: "Ask ChartCoach", body: "Ask about the current moment or the whole lesson. Answers stay grounded in this lecture." },
  { target: "progress", eyebrow: "YOUR PROGRESS", title: "Build progress as you learn", body: "Watch continuously, complete the required questions, and your progress will be saved so you can resume later." },
];

export default function LessonTour({ storageKey, openRequest = 0 }: Props) {
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const step = stepIndex === null ? null : steps[stepIndex];

  useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) setStepIndex(0);
    } catch {
      setStepIndex(0);
    }
  }, [storageKey]);

  useEffect(() => {
    if (openRequest > 0) setStepIndex(0);
  }, [openRequest]);

  useEffect(() => {
    if (!step) return;
    const update = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour-target="${step.target}"]`);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [step]);

  const position = useMemo(() => {
    const below = box.top + box.height + 18;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
    return { top: Math.min(below, viewportHeight - 250), left: Math.max(16, Math.min(box.left, viewportWidth - 360)) };
  }, [box]);

  if (!step || stepIndex === null) return null;
  const finish = (value: "completed" | "dismissed") => {
    try { localStorage.setItem(storageKey, value); } catch { /* best effort in private browsing */ }
    setStepIndex(null);
  };
  const next = () => stepIndex === steps.length - 1 ? finish("completed") : setStepIndex(stepIndex + 1);

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none" aria-hidden={false}>
      <div className="absolute inset-0 bg-slate-950/55" />
      <div
        className="absolute rounded-xl border-2 border-blue-400 shadow-[0_0_0_9999px_rgba(15,23,42,.55),0_0_0_6px_rgba(96,165,250,.28)] transition-all duration-200"
        style={{ top: box.top - 5, left: box.left - 5, width: Math.max(box.width + 10, 10), height: Math.max(box.height + 10, 10) }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lesson player guide"
        className="pointer-events-auto absolute w-[min(340px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl"
        style={{ top: position.top, left: position.left }}
      >
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-blue-600">{step.eyebrow}</p>
        <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {stepIndex > 0 && (
              <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900" onClick={() => setStepIndex(stepIndex - 1)}>Previous</button>
            )}
            <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900" onClick={() => finish("dismissed")}>Skip tour</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{stepIndex + 1} / {steps.length}</span>
            <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700" onClick={next}>{stepIndex === steps.length - 1 ? "Done" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
