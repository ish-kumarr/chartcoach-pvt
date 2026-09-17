import { afterEach, expect, it, vi } from "vitest";
import {
  LessonController,
  type LessonView,
  type LessonApi,
} from "./lesson-controller";
import {
  lesson,
  authorization,
  progress,
  FakePlayer,
} from "@/test/lesson-fixtures";
afterEach(() => vi.useRealTimers());
async function seekFixture(passed = true, start = 0) {
  vi.useFakeTimers();
  const player = new FakePlayer();
  const saved = { ...progress, passed_prompt_ids: passed ? ["q1"] : [] };
  let view: LessonView;
  const controller = new LessonController(
    { ...lesson, progress: saved }, { ...authorization, resume_position_seconds: start }, player,
    {
      getLesson: async () => ({ ...lesson, progress: saved }),
      authorizePlayback: async () => authorization,
      saveProgress: async (_id, observation) => ({ ...saved, resume_position_seconds: observation.position_seconds }),
      submitAttempt: async () => { throw new Error("unused"); },
    },
    (next) => { view = next; }, () => {},
  );
  await controller.start();
  return { controller, player, view: () => view! };
}
it("blocks seeking beyond the furthest naturally watched position", async () => {
  const f = await seekFixture();
  await f.controller.togglePlay();
  f.controller.seek(30);
  expect(f.player.snapshot().position).toBe(0);
  expect(f.view().seekBlocked).toBe(true);
  f.controller.destroy();
});
it("allows forward review through the furthest naturally watched position", async () => {
  const f = await seekFixture();
  await f.controller.togglePlay();
  for (let position = 1; position <= 30; position++) {
    await vi.advanceTimersByTimeAsync(1000);
    f.player.emit("timeupdate", { position, paused: false });
  }
  f.controller.seek(10);
  f.controller.seek(25);
  expect(f.player.snapshot().position).toBe(25);
  expect(f.view().seekBlocked).toBe(false);
  expect(f.view().seekableUntil).toBe(30);
  f.controller.seek(45);
  expect(f.player.snapshot().position).toBe(30);
  expect(f.view().seekBlocked).toBe(true);
  f.controller.destroy();
});
it("does not unlock the timeline from paused time updates", async () => {
  const f = await seekFixture();
  await vi.advanceTimersByTimeAsync(1000);
  f.player.emit("timeupdate", { position: 1, paused: true });
  f.controller.seek(5);
  expect(f.player.snapshot().position).toBe(0);
  expect(f.view().seekableUntil).toBe(0);
  f.controller.destroy();
});
it("still permits backward review without showing a forward-seek warning", async () => {
  const f = await seekFixture(true, 30);
  f.controller.seek(60);
  f.controller.seek(10);
  expect(f.player.snapshot().position).toBe(10);
  expect(f.view().seekBlocked).toBe(false);
  f.controller.destroy();
});
it("snaps external forward seeks back to the last watched position", async () => {
  const f = await seekFixture();
  f.player.seek(50);
  expect(f.player.snapshot().position).toBe(0);
  expect(f.view().seekBlocked).toBe(true);
  f.controller.destroy();
});
it("does not bypass an unanswered question through forward seeking", async () => {
  const f = await seekFixture(false);
  f.controller.seek(50);
  expect(f.view().prompt).toBeNull();
  expect(f.view().seekBlocked).toBe(true);
  f.controller.destroy();
});
it("keeps heartbeats running after authorization recovery during initial load", async () => {
  vi.useFakeTimers();
  const player = new FakePlayer();
  let loads = 0,
    saves = 0;
  player.load = async () => {
    if (loads++ === 0) {
      const error = {
        category: "authorization" as const,
        retryable: true,
        message: "Refresh needed",
      };
      player.emit("error", {}, error);
      throw error;
    }
    player.emit("ready");
  };
  const api: LessonApi = {
    getLesson: async () => lesson,
    authorizePlayback: async () => authorization,
    saveProgress: async () => {
      saves++;
      return progress;
    },
    submitAttempt: async () => {
      throw new Error("unused");
    },
  };
  const views: LessonView[] = [];
  const controller = new LessonController(
    lesson,
    authorization,
    player,
    api,
    (view) => views.push(view),
    () => {},
  );
  await controller.start();
  await vi.advanceTimersByTimeAsync(8000);
  expect(views.at(-1)?.ready).toBe(true);
  expect(saves).toBeGreaterThan(0);
  controller.destroy();
});
it("serializes a pending answer with heartbeat writes to prevent overwriting passed prompts", async () => {
  vi.useFakeTimers();
  const player = new FakePlayer();
  let resolve!: () => void;
  let answerPending = false;
  let overlap = false;
  const saved = {
    ...progress,
    resume_position_seconds: 20,
    pending_prompt_id: "q1",
  };
  const api: LessonApi = {
    getLesson: async () => ({ ...lesson, progress: saved }),
    authorizePlayback: async () => authorization,
    saveProgress: async () => {
      if (answerPending) overlap = true;
      return saved;
    },
    submitAttempt: async () => {
      answerPending = true;
      await new Promise<void>((r) => (resolve = r));
      answerPending = false;
      return {
        is_correct: true,
        feedback: "Correct",
        explanation: "Correct",
        retry_allowed: true,
        progress: {
          ...saved,
          passed_prompt_ids: ["q1"],
          pending_prompt_id: null,
        },
      };
    },
  };
  const controller = new LessonController(
    { ...lesson, progress: saved },
    { ...authorization, resume_position_seconds: 20, pending_prompt_id: "q1" },
    player,
    api,
    () => {},
    () => {},
  );
  await controller.start();
  const answer = controller.answer("a");
  await vi.advanceTimersByTimeAsync(8000);
  expect(overlap).toBe(false);
  resolve();
  await answer;
  controller.destroy();
});
