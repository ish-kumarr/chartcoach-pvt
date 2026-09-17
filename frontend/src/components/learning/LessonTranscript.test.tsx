import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LessonTranscript from "./LessonTranscript";
afterEach(() => vi.unstubAllGlobals());
it("follows video time and seeks from searchable transcript lines", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("WEBVTT\n\n00:00.000 --> 00:02.000\nFirst line\n\n00:02.000 --> 00:05.000\nSecond line")));
  const onSeek = vi.fn();
  const props = { url: "/captions.vtt", duration: 5, position: 1, language: "English", disabled: false, onSeek };
  const { rerender } = render(<LessonTranscript {...props} />);
  expect(await screen.findByRole("button", { name: /First line/ })).toHaveAttribute("aria-current", "true");
  rerender(<LessonTranscript {...props} position={3} />);
  expect(screen.getByRole("button", { name: /Second line/ })).toHaveAttribute("aria-current", "true");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second" } });
  expect(screen.queryByRole("button", { name: /First line/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Second line/ }));
  expect(onSeek).toHaveBeenCalledWith(2);
});
