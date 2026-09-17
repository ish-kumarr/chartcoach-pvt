export type PlaybackStartupReport = {
  label: string;
  total_ms: number;
  phases_ms: Record<string, number>;
};

export function createPlaybackStartupTimer(
  label: string,
  now: () => number = () => performance.now(),
  sink?: (report: PlaybackStartupReport) => void,
) {
  const startedAt = now();
  const phases: Record<string, number> = {};
  return {
    mark(phase: string) {
      phases[phase] = Math.max(0, Math.round(now() - startedAt));
    },
    report(): PlaybackStartupReport {
      const report = {
        label,
        total_ms: Math.max(0, Math.round(now() - startedAt)),
        phases_ms: { ...phases },
      };
      sink?.(report);
      return report;
    },
  };
}
