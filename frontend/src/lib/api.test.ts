import { expect, it } from "vitest";
import { resolveApiUrl } from "./api";

it("uses the browser hostname for the local API when no URL is configured", () => {
  expect(resolveApiUrl(undefined, { protocol: "http:", hostname: "127.0.0.1" })).toBe("http://127.0.0.1:8000");
  expect(resolveApiUrl(undefined, { protocol: "http:", hostname: "localhost" })).toBe("http://localhost:8000");
});

it("keeps an explicitly configured API URL and removes its trailing slash", () => {
  expect(resolveApiUrl("https://api.example.test/", { protocol: "http:", hostname: "localhost" })).toBe("https://api.example.test");
});
