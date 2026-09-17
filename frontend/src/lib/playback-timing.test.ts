import { expect, it, vi } from "vitest";
import { createPlaybackStartupTimer } from "./playback-timing";

it("records ordered phase durations without retaining sensitive values", () => {
  let now = 100;
  const sink = vi.fn();
  const timer = createPlaybackStartupTimer("lesson-l1", () => now, sink);

  now = 160;
  timer.mark("engine_import");
  now = 240;
  timer.mark("media_ready");
  const report = timer.report();

  expect(report).toEqual({
    label: "lesson-l1",
    total_ms: 140,
    phases_ms: { engine_import: 60, media_ready: 140 },
  });
  expect(sink).toHaveBeenCalledWith(report);
});
