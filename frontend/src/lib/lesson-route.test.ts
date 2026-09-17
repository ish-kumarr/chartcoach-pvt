import { describe, expect, it } from "vitest";
import { canonicalLessonHref, resolveLessonRoute } from "./lesson-route";

describe("canonical lesson routes", () => {
  it("maps the pilot course module to its protected lesson", () => {
    expect(resolveLessonRoute({ courseSlug: "price-action-secrets", moduleNumber: "1" })).toBe("l1");
  });

  it("rejects unknown course/module combinations", () => {
    expect(resolveLessonRoute({ courseSlug: "unknown", moduleNumber: "1" })).toBeNull();
  });

  it("builds protected and preview hrefs", () => {
    expect(canonicalLessonHref({ courseSlug: "price-action-secrets", moduleNumber: "1" })).toBe(
      "/learn/price-action-secrets/1",
    );
    expect(canonicalLessonHref({ courseSlug: "price-action-secrets", moduleNumber: "1" }, true)).toBe(
      "/learn/price-action-secrets/1?preview=1",
    );
  });
});
