import { describe, expect, it } from "vitest";
import { lessonPageMode } from "./lesson-page-mode";

describe("lessonPageMode", () => {
  it("opens the non-DRM preview only in non-production when explicitly requested", () => {
    expect(lessonPageMode({ isProduction: false, preview: "1" })).toBe("preview");
    expect(lessonPageMode({ isProduction: false, preview: null })).toBe("protected");
    expect(lessonPageMode({ isProduction: true, preview: "1" })).toBe("protected");
  });
});
