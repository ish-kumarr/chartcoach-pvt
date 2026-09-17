// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
afterEach(() => vi.unstubAllEnvs());
const request = (body = {}, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/lesson-chat", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
it("stays disconnected without a key and never invents a response", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("AI_GATEWAY_API_KEY", "");
  expect(await (await GET()).json()).toEqual({ configured: false });
  expect((await POST(request())).status).toBe(503);
});
it("rejects cross-origin and malformed requests before generation", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("AI_GATEWAY_API_KEY", "test-not-a-real-key");
  expect((await POST(request({}, "https://elsewhere.example"))).status).toBe(403);
  expect((await POST(request({ lessonId: "another-lesson" }))).status).toBe(400);
});
it("does not expose the local assistant in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(request())).status).toBe(404);
});
