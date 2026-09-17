import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import CourseModal from "./CourseModal";
import { INITIAL_COURSES as courses } from "@/lib/courses";

const pilotCourse = {
  ...courses[0],
  modules: [
    {
      id: "pilot-module",
      title: "Pilot lesson",
      lessons: [{ id: "l1", title: "Protected pilot", duration: "12m", type: "video" as const }],
    },
  ],
};

it("opens the pilot video in the dedicated lesson route", () => {
  render(
    <CourseModal
      course={pilotCourse}
      userEmail="test@example.test"
      onClose={() => {}}
      onLaunchSimulator={() => {}}
    />,
  );
  expect(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/learn/price-action-secrets/1"),
  ).toBe(true);
});
it("does not offer manual completion for the protected pilot", () => {
  render(
    <CourseModal
      course={pilotCourse}
      userEmail="test@example.test"
      onClose={() => {}}
      onLaunchSimulator={() => {}}
    />,
  );
  const pilot = screen.getByRole("link", {
    name: "Protected pilot",
  });
  expect(
    pilot.parentElement?.parentElement?.querySelector(
      'button[title="Mark as Completed"]',
    ),
  ).toBeNull();
});
