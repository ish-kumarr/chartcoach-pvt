import { expect, it, vi } from "vitest";
import { createPlayerAdapter } from "./player-adapter";
import type { PlaybackAuthorization } from "./learning-api";
const source = {
  manifest_url: "https://media?token=secret",
  widevine_license_url: "widevine",
  playready_license_url: "playready",
  fairplay_license_url: "fairplay",
  fairplay_certificate_url: "certificate",
} as PlaybackAuthorization;
function setup(fairplay = false) {
  const video = document.createElement("video");
  vi.spyOn(video, "pause").mockImplementation(() => {});
  vi.spyOn(video, "load").mockImplementation(() => {});
  const listeners = new Map<string, (event: unknown) => void>();
  const configuration: Record<string, unknown>[] = [];
  const filters = new Set<unknown>();
  let destroyed = 0;
  const tracks = [
    { language: "en", active: false },
    { language: "fr", active: false },
  ];
  const player = {
    attach: async () => {},
    load: vi.fn(async () => {}),
    destroy: async () => {
      destroyed++;
    },
    configure: (c: Record<string, unknown>) => {
      configuration.push(c);
      return true;
    },
    addEventListener: (name: string, cb: (e: unknown) => void) =>
      listeners.set(name, cb),
    removeEventListener: (name: string) => listeners.delete(name),
    getTextTracks: () => tracks,
    addTextTrackAsync: async () => ({}),
    selectTextTrack: (selected: unknown) => {
      for (const track of tracks) track.active = track === selected;
    },
    getNetworkingEngine: () => ({
      registerRequestFilter: (f: unknown) => filters.add(f),
      registerResponseFilter: (f: unknown) => filters.add(f),
      unregisterRequestFilter: (f: unknown) => filters.delete(f),
      unregisterResponseFilter: (f: unknown) => filters.delete(f),
    }),
  };
  const runtime = {
    Player: Object.assign(
      function () {
        return player;
      },
      { isBrowserSupported: () => true },
    ),
    polyfill: {
      installAll: () => {},
      PatchedMediaKeysApple: { install: () => {} },
    },
    drm: {
      FairPlay: {
        isFairPlaySupported: async () => fairplay,
        muxInitDataTransform: () => {},
        muxFairPlayRequest: () => {},
        commonFairPlayResponse: () => {},
      },
    },
    text: { NativeTextDisplayer: function () {} },
    net: { NetworkingEngine: { RequestType: { LICENSE: 2 } } },
  };
  const adapter = createPlayerAdapter(video, async () => runtime as never);
  return {
    adapter,
    video,
    player,
    listeners,
    configuration,
    filters,
    destroyed: () => destroyed,
  };
}
it("reports actual native media state, validates seeks, and releases subscriptions on repeated teardown", async () => {
  const t = setup();
  await t.adapter.load(source, 4);
  const states: number[] = [];
  t.adapter.subscribe((e) => states.push(e.snapshot.position));
  t.video.currentTime = 7;
  t.video.dispatchEvent(new Event("timeupdate"));
  expect(states.at(-1)).toBe(7);
  expect(() => t.adapter.seek(NaN)).toThrow();
  await t.adapter.destroy();
  await t.adapter.destroy();
  t.video.currentTime = 8;
  t.video.dispatchEvent(new Event("timeupdate"));
  expect(states.at(-1)).toBe(7);
  expect(t.destroyed()).toBe(1);
  expect(t.listeners.size).toBe(0);
});
it("normalizes nested license authorization errors without leaking the signed URI", async () => {
  const t = setup();
  await t.adapter.load(source, 0);
  const errors: unknown[] = [];
  t.adapter.subscribe((e) => {
    if (e.error) errors.push(e.error);
  });
  t.listeners.get("error")?.({
    detail: {
      category: 6,
      code: 6007,
      data: [
        {
          category: 1,
          code: 1001,
          data: ["https://license?token=secret", 403],
        },
      ],
    },
  });
  expect(errors).toEqual([
    {
      category: "authorization",
      retryable: true,
      message: "Playback authorization needs refreshing.",
    },
  ]);
  await t.adapter.destroy();
});
it("enables only English text through the pinned core track API", async () => {
  const t = setup();
  await t.adapter.load(source, 0);
  t.adapter.setCaptions(true);
  expect(t.adapter.snapshot().captionsEnabled).toBe(true);
  t.adapter.setCaptions(false);
  expect(t.adapter.snapshot().captionsEnabled).toBe(false);
  expect(t.configuration[0]).toMatchObject({
    preferredText: [{ language: "en" }],
  });
  await t.adapter.destroy();
});
it("sanitizes vendor authorization errors and rejected play", async () => {
  const t = setup();
  await t.adapter.load(source, 0);
  const errors: unknown[] = [];
  t.adapter.subscribe((e) => {
    if (e.error) errors.push(e.error);
  });
  t.listeners.get("error")?.({
    detail: { category: 1, data: ["https://license?token=secret", 403] },
  });
  expect(errors).toEqual([
    {
      category: "authorization",
      retryable: true,
      message: "Playback authorization needs refreshing.",
    },
  ]);
  vi.spyOn(t.video, "play").mockRejectedValue(new Error("private"));
  await expect(t.adapter.play()).rejects.toMatchObject({ category: "media" });
  expect(JSON.stringify(errors)).not.toContain("private");
  await t.adapter.destroy();
});
it("configures only the FairPlay path with scoped filters and certificate, disposing filters", async () => {
  const t = setup(true);
  await t.adapter.load(source, 0);
  expect(t.configuration).toContainEqual(
    expect.objectContaining({ streaming: { useNativeHlsForFairPlay: true } }),
  );
  expect(t.filters.size).toBe(2);
  await t.adapter.destroy();
  expect(t.filters.size).toBe(0);
  const widevine = setup();
  await widevine.adapter.load(source, 0);
  expect(widevine.filters.size).toBe(0);
  await widevine.adapter.destroy();
});
it("does not apply Mux FairPlay transforms to a local provider contract", async () => {
  const t = setup(true);
  await t.adapter.load(
    { ...source, provider: "local", drm: { type: "development-clear-key" } },
    0,
  );
  expect(t.filters.size).toBe(1);
  expect(t.configuration).not.toContainEqual(
    expect.objectContaining({ streaming: { useNativeHlsForFairPlay: true } }),
  );
  await t.adapter.destroy();
});
it("configures development Clear Key with DASH and credentialed license requests", async () => {
  const t = setup();
  const local = {
    ...source,
    provider: "local" as const,
    manifest_url: "http://127.0.0.1:8000/media/playback-sessions/session-1/manifest.mpd",
    drm: {
      type: "development-clear-key" as const,
      license_url: "http://127.0.0.1:8000/media/playback-sessions/session-1/clearkey",
    },
  };

  await t.adapter.load(local, 0);

  expect(t.configuration).toContainEqual(
    expect.objectContaining({
      drm: { servers: { "org.w3.clearkey": local.drm.license_url } },
    }),
  );
  expect(t.player.load).toHaveBeenCalledWith(local.manifest_url, 0, "application/dash+xml");
  expect(t.filters.size).toBe(1);
  await t.adapter.destroy();
  expect(t.filters.size).toBe(0);
});
it("ignores a stale load after destroy during engine import", async () => {
  const t = setup();
  let resolve!: (v: never) => void;
  const adapter = createPlayerAdapter(
    t.video,
    () => new Promise((r) => (resolve = r)),
  );
  const pending = adapter.load(source, 0);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await adapter.destroy();
  resolve({} as never);
  await pending;
  expect(adapter.snapshot().paused).toBe(true);
});
