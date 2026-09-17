import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import LessonExperience from "./LessonExperience";
import { LearningApiError } from "@/lib/learning-api";
import { lesson, authorization, FakePlayer } from "@/test/lesson-fixtures";
it("waits for authentication before requesting protected lesson metadata", async () => {
  let resolve!: (response: Response) => void;
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Promise<Response>((r) => (resolve = r));
  });
  render(
    <AuthProvider>
      <LessonExperience lessonId="l1" />
    </AuthProvider>,
  );
  expect(urls).toHaveLength(1);
  expect(urls[0]).toMatch(/users\/me$/);
  expect(screen.getByRole("status")).toHaveTextContent(/session/i);
  await act(async () => resolve(new Response("{}", { status: 401 })));
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
  vi.unstubAllGlobals();
});
it.each([403, 503])(
  "renders sanitized %s state after authenticated authorization",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ id: "u", email: "a@test", full_name: "Learner" }),
        ),
    );
    const api = {
      getLesson: async () => lesson,
      authorizePlayback: async () => {
        throw new LearningApiError(status);
      },
    };
    render(
      <AuthProvider>
        <LessonExperience lessonId="l1" api={api as never} />
      </AuthProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status === 403 ? /enrollment/i : /temporarily unavailable/i,
    );
    if (status === 503)
      expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    vi.unstubAllGlobals();
  },
);
it("renders the authorized lesson using the adapter seam", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ id: "u", email: "a@test", full_name: "Learner" }),
      ),
  );
  render(
    <AuthProvider>
      <LessonExperience
        lessonId="l1"
        api={
          {
            getLesson: async () => lesson,
            authorizePlayback: async () => authorization,
          } as never
        }
        factory={() => new FakePlayer()}
      />
    </AuthProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Reading market structure" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("region", { name: "Lesson video" }),
  ).toBeVisible();
  vi.unstubAllGlobals();
});

it("labels local protected playback while vendor credentials are pending", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ id: "u", email: "a@test", full_name: "Learner" }),
      ),
  );
  render(
    <AuthProvider>
      <LessonExperience
        lessonId="l1"
        api={
          {
            getLesson: async () => lesson,
            authorizePlayback: async () => ({
              ...authorization,
              provider: "local",
              drm: { type: "development-clear-key" },
              drm_readiness: {
                mode: "development-clear-key",
                credentials_status: "pending",
                production_ready: false,
              },
            }),
          } as never
        }
        factory={() => new FakePlayer()}
      />
    </AuthProvider>,
  );
  expect(
    await screen.findByText(/development protected playback/i),
  ).toBeVisible();
  vi.unstubAllGlobals();
});
