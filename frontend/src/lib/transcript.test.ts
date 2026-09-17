import { expect, it } from "vitest";
import { activeCueAt, parseTranscript } from "./transcript";

it("parses SRT, preserves Hindi text and clips captions at media end", () => {
  const cues = parseTranscript("1\n00:00:01,000 --> 00:00:03,000\nनमस्ते\n\n2\n00:00:04,000 --> 00:00:08,000\n<b>Next</b>", 6);
  expect(cues.map(({ start, end, text }) => ({ start, end, text }))).toEqual([{ start: 1, end: 3, text: "नमस्ते" }, { start: 4, end: 6, text: "Next" }]);
  expect(activeCueAt(cues, 1)?.text).toBe("नमस्ते");
  expect(activeCueAt(cues, 3)).toBeUndefined();
  expect(activeCueAt(cues, 5)?.text).toBe("Next");
  expect(activeCueAt(cues, 6)).toBeUndefined();
});
it("parses WebVTT and ignores notes and malformed cues", () => {
  expect(parseTranscript("WEBVTT\n\nNOTE ignore\n\n00:01.000 --> 00:02.000 align:start\nA &amp; B\n\nbad --> cue\nno")).toEqual([{ id: "cue-0", start: 1, end: 2, text: "A & B" }]);
});
