import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import LessonTour from "./LessonTour";

beforeEach(() => localStorage.clear());

it("recommends the first lesson guide with anchored labels and forward-seek guidance", async () => {
  const user = userEvent.setup();
  render(
    <div>
      <button data-tour-target="player">Player</button>
      <LessonTour storageKey="chartcoach-tour-test" />
    </div>,
  );

  expect(screen.getByRole("dialog", { name: "Lesson player guide" })).toBeVisible();
  expect(screen.getByText("Meet your lesson player")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Your watched range")).toBeVisible();
  expect(screen.getByText(/timeline unlocks as you watch/i)).toBeVisible();
});

it("lets learners skip the recommended guide and remembers that choice", async () => {
  const user = userEvent.setup();
  render(<LessonTour storageKey="chartcoach-tour-test" />);
  await user.click(screen.getByRole("button", { name: "Skip tour" }));
  expect(screen.queryByRole("dialog", { name: "Lesson player guide" })).not.toBeInTheDocument();
  expect(localStorage.getItem("chartcoach-tour-test")).toBe("dismissed");
});

it("reopens the guide when requested after dismissal", async () => {
  const view = render(<LessonTour storageKey="chartcoach-tour-test" />);
  await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
  view.rerender(<LessonTour storageKey="chartcoach-tour-test" openRequest={1} />);
  expect(await screen.findByRole("dialog", { name: "Lesson player guide" })).toBeVisible();
});

it("lets learners move back to the previous tutorial step", async () => {
  const user = userEvent.setup();
  render(
    <div>
      <button data-tour-target="player">Player</button>
      <button data-tour-target="seek">Seek</button>
      <LessonTour storageKey="chartcoach-tour-test" />
    </div>,
  );
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Your watched range")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Meet your lesson player")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
});
