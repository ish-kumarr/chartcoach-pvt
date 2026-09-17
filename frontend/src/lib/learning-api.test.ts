import { afterEach, expect, it, vi } from "vitest";
import * as api from "./learning-api";
afterEach(() => vi.unstubAllGlobals());
it.each([401, 403, 409, 422, 503])(
  "normalizes %s without exposing backend capabilities",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ detail: "https://secret?token=private" }),
          { status },
        ),
    );
    const error = await api.getLesson("l1").catch((e) => e);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("private");
  },
);
it("sends cookie-authenticated lesson requests and exact progress/attempt payloads", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ lesson_id: "l1" }));
  });
  expect(await api.getLesson("l1")).toEqual({ lesson_id: "l1" });
  await api.authorizePlayback("l1");
  await api.renewPlayback("l1", "s");
  await api.saveProgress("l1", {
    playback_session_id: "s",
    position_seconds: 8,
    start_seconds: 0,
    end_seconds: 8,
  });
  await api.submitAttempt("l1", "q1", {
    playback_session_id: "s",
    option_id: "a",
  });
  expect(requests.map((r) => r.init.credentials)).toEqual([
    "include",
    "include",
    "include",
    "include",
    "include",
  ]);
  expect(requests.map((r) => r.init.method)).toEqual([
    "GET",
    "POST",
    "POST",
    "PUT",
    "POST",
  ]);
  expect(requests[0].url).toBe("http://localhost:8000/learning/lessons/l1");
  expect(requests[1].url).toMatch(/\/lessons\/l1\/playback-sessions$/);
  expect(requests[2].url).toMatch(/\/lessons\/l1\/playback-sessions\/s\/renew$/);
  expect(JSON.parse(requests[3].init.body as string)).toEqual({
    playback_session_id: "s",
    position_seconds: 8,
    start_seconds: 0,
    end_seconds: 8,
  });
  expect(requests[4].url).toMatch(/\/lessons\/l1\/prompts\/q1\/attempts$/);
});
