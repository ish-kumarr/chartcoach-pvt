import type Shaka from "shaka-player";
import type { LessonMetadata, PlaybackAuthorization } from "./learning-api";
import { createPlaybackStartupTimer } from "./playback-timing";

export type PlaybackError = {
  category: "unsupported" | "authorization" | "network" | "drm" | "media";
  retryable: boolean;
  message: string;
};
export type PlaybackSnapshot = {
  position: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  volume: number;
  playbackRate: number;
  muted: boolean;
  captionsAvailable: boolean;
  captionsEnabled: boolean;
  seekableStart: number;
  seekableEnd: number;
};
export type PlaybackEvent = {
  type: string;
  snapshot: PlaybackSnapshot;
  error?: PlaybackError;
};
export interface PlayerAdapter {
  load(
    source: PlaybackAuthorization,
    start: number,
    captions?: LessonMetadata["captions"],
  ): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(value: number): void;
  setPlaybackRate(value: number): void;
  setMuted(value: boolean): void;
  setCaptions(value: boolean): void;
  snapshot(): PlaybackSnapshot;
  subscribe(listener: (event: PlaybackEvent) => void): () => void;
  capabilities(): {
    fullscreen: boolean;
    drm: "fairplay" | "widevine-playready" | "clearkey" | "unknown";
  };
  destroy(): Promise<void>;
}
export type PlayerAdapterFactory = (video: HTMLVideoElement) => PlayerAdapter;
type Runtime = typeof Shaka;
const appleInstalled = new WeakSet<object>();
function isAuthorizationFailure(error: unknown, depth = 0): boolean {
  if (depth > 4 || !error || typeof error !== "object") return false;
  const data = (error as { data?: unknown[] }).data;
  return (
    Array.isArray(data) &&
    data.some(
      (item) =>
        item === 401 || item === 403 || isAuthorizationFailure(item, depth + 1),
    )
  );
}
function sanitized(error: unknown): PlaybackError {
  const data = error as { category?: number; data?: unknown[]; code?: number };
  if (isAuthorizationFailure(error))
    return {
      category: "authorization",
      retryable: true,
      message: "Playback authorization needs refreshing.",
    };
  const category =
    data?.category === 1 ? "network" : data?.category === 6 ? "drm" : "media";
  return {
    category,
    retryable: true,
    message:
      category === "network"
        ? "The video connection was interrupted."
        : "Playback was interrupted. Please retry.",
  };
}
export function createPlayerAdapter(
  video: HTMLVideoElement,
  importEngine: () => Promise<Runtime> = async () =>
    (await import("shaka-player")).default,
): PlayerAdapter {
  let player: Shaka.Player | null = null;
  let disposed = false,
    generation = 0,
    buffering = false,
    captionsAvailable = false;
  let drm: "fairplay" | "widevine-playready" | "clearkey" | "unknown" = "unknown";
  let disposal: Promise<void> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<(event: PlaybackEvent) => void>();
  const releases: (() => void)[] = [];
  const nativeEvents = [
    "timeupdate",
    "play",
    "pause",
    "seeking",
    "seeked",
    "ended",
    "loadedmetadata",
    "volumechange",
    "ratechange",
    "waiting",
    "playing",
    "error",
  ];
  function snapshot(): PlaybackSnapshot {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    return {
      position: video.currentTime || 0,
      duration,
      paused: video.paused,
      ended: video.ended,
      buffering,
      volume: video.volume,
      playbackRate: video.playbackRate,
      muted: video.muted,
      captionsAvailable,
      captionsEnabled:
        player?.getTextTracks().some((track) => track.active) ?? false,
      seekableStart: video.seekable.length ? video.seekable.start(0) : 0,
      seekableEnd: video.seekable.length
        ? video.seekable.end(video.seekable.length - 1)
        : duration,
    };
  }
  function emit(type: string, error?: PlaybackError) {
    if (!disposed)
      for (const listener of listeners)
        listener({ type, snapshot: snapshot(), ...(error ? { error } : {}) });
  }
  function native(event: Event) {
    if (event.type === "waiting") buffering = true;
    if (event.type === "playing" || event.type === "ended") buffering = false;
    emit(
      event.type,
      event.type === "error" ? sanitized(video.error) : undefined,
    );
  }
  nativeEvents.forEach((name) => video.addEventListener(name, native));
  async function releasePlayer() {
    releases.splice(0).forEach((release) => release());
    const old = player;
    player = null;
    if (old) await old.destroy();
  }
  return {
    snapshot,
    capabilities: () => ({
      fullscreen:
        typeof document.documentElement.requestFullscreen === "function",
      drm,
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load(source, start, captions) {
      const ticket = ++generation;
      const load = async () => {
        if (disposed || ticket !== generation) return;
        const timing = createPlaybackStartupTimer(
          `player:${source.provider ?? source.drm?.type ?? "unknown"}`,
          undefined,
          process.env.NODE_ENV === "test"
            ? undefined
            : (report) => console.info("[ChartCoach playback startup]", report),
        );
        try {
          await releasePlayer();
          const runtime = await importEngine();
          timing.mark("engine_import");
          if (disposed || ticket !== generation) return;
          const fairplay = await runtime.drm.FairPlay.isFairPlaySupported();
          timing.mark("drm_capability_check");
          if (disposed || ticket !== generation) return;
          runtime.polyfill.installAll();
          if (fairplay && !appleInstalled.has(runtime)) {
            runtime.polyfill.PatchedMediaKeysApple.install();
            appleInstalled.add(runtime);
          }
          if (!runtime.Player.isBrowserSupported())
            throw {
              category: "unsupported",
              retryable: false,
              message: "This browser does not support secure playback.",
            };
          const instance = new runtime.Player();
          player = instance;
          const onError = (event: Event) =>
            emit("error", sanitized((event as CustomEvent).detail));
          const onBuffer = (event: Event) => {
            buffering = Boolean(
              (event as unknown as { buffering: boolean }).buffering,
            );
            emit("buffering");
          };
          const onTracks = () => {
            captionsAvailable = instance
              .getTextTracks()
              .some((track) => track.language.startsWith("en"));
            emit("tracks");
          };
          for (const [name, cb] of [
            ["error", onError],
            ["buffering", onBuffer],
            ["trackschanged", onTracks],
          ] as const) {
            instance.addEventListener(name, cb);
            releases.push(() => instance.removeEventListener(name, cb));
          }
          await instance.attach(video);
          timing.mark("player_attach");
          if (disposed || ticket !== generation) return;
          const providerDrm = source.drm?.type ?? "mux";
          drm = providerDrm === "development-clear-key"
            ? "clearkey"
            : fairplay
              ? "fairplay"
              : "widevine-playready";
          instance.configure({
            preferredText: [{ language: "en" }],
            textDisplayFactory: () =>
              new runtime.text.NativeTextDisplayer(instance),
            drm: providerDrm === "development-clear-key"
              ? { servers: { "org.w3.clearkey": source.drm?.license_url ?? "" } }
              : {
                  servers: {
                    "com.widevine.alpha": source.widevine_license_url,
                    "com.microsoft.playready": source.playready_license_url,
                  },
                  advanced: source.drm_policy
                    ? {
                        "com.widevine.alpha": {
                          videoRobustness: source.drm_policy.widevine_video_robustness,
                          audioRobustness: source.drm_policy.widevine_audio_robustness,
                        },
                      }
                    : undefined,
                },
          });
          if (providerDrm === "development-clear-key") {
            const network = instance.getNetworkingEngine();
            const credentials: Shaka.extern.RequestFilter = (_type, request) => {
              request.allowCrossSiteCredentials = true;
            };
            network?.registerRequestFilter(credentials);
            releases.push(() => network?.unregisterRequestFilter(credentials));
          }
          if (fairplay && providerDrm === "mux") {
            const helpers = runtime.drm.FairPlay;
            if (
              !helpers.muxFairPlayRequest ||
              !helpers.commonFairPlayResponse ||
              !helpers.muxInitDataTransform
            )
              throw {
                category: "unsupported",
                retryable: false,
                message: "Secure playback is unavailable on this browser.",
              };
            instance.configure({
              streaming: { useNativeHlsForFairPlay: true },
              drm: {
                servers: { "com.apple.fps.1_0": source.fairplay_license_url },
                advanced: {
                  "com.apple.fps.1_0": {
                    serverCertificateUri: source.fairplay_certificate_url,
                  },
                },
                initDataTransform: helpers.muxInitDataTransform,
              },
            });
            const network = instance.getNetworkingEngine();
            const request: Shaka.extern.RequestFilter = (
              type,
              req,
              context,
            ) => {
              if (type === runtime.net.NetworkingEngine.RequestType.LICENSE)
                helpers.muxFairPlayRequest(type, req, context);
            };
            const response: Shaka.extern.ResponseFilter = (
              type,
              res,
              context,
            ) => {
              if (type === runtime.net.NetworkingEngine.RequestType.LICENSE)
                helpers.commonFairPlayResponse(type, res, context);
            };
            network?.registerRequestFilter(request);
            network?.registerResponseFilter(response);
            releases.push(() => {
              network?.unregisterRequestFilter(request);
              network?.unregisterResponseFilter(response);
            });
          }
          await instance.load(
            source.manifest_url,
            Math.max(0, Number.isFinite(start) ? start : 0),
            providerDrm === "development-clear-key"
              ? "application/dash+xml"
              : "application/x-mpegURL",
          );
          timing.mark("manifest_and_license");
          if (disposed || ticket !== generation) return;
          if (
            captions &&
            !instance
              .getTextTracks()
              .some((track) => track.language.startsWith("en"))
          )
            await instance.addTextTrackAsync(
              captions.url,
              "en",
              "subtitles",
              "text/vtt",
              "",
              captions.label,
            );
          if (disposed || ticket !== generation) return;
          onTracks();
          timing.mark("captions");
          buffering = false;
          emit("ready");
          timing.mark("ready");
          timing.report();
        } catch (error) {
          if (disposed || ticket !== generation) return;
          const normalized =
            (error as PlaybackError)?.category === "unsupported"
              ? (error as PlaybackError)
              : sanitized(error);
          await releasePlayer();
          emit("error", normalized);
          throw normalized;
        }
      };
      queue = queue.catch(() => {}).then(load);
      return queue;
    },
    async play() {
      if (disposed) return;
      try {
        await video.play();
      } catch {
        const error = sanitized(null);
        emit("error", error);
        throw error;
      }
    },
    pause() {
      if (!disposed) video.pause();
    },
    seek(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0)
        throw new RangeError("Invalid playback position");
      if (!disposed) video.currentTime = seconds;
    },
    setVolume(value) {
      if (Number.isFinite(value) && !disposed)
        video.volume = Math.min(1, Math.max(0, value));
    },
    setPlaybackRate(value) {
      if (!disposed && Number.isFinite(value) && value >= 0.5 && value <= 2) video.playbackRate = value;
    },
    setMuted(value) {
      if (!disposed) video.muted = value;
    },
    setCaptions(value) {
      if (disposed) return;
      player?.selectTextTrack(
        value
          ? player
              .getTextTracks()
              .find((track) => track.language.startsWith("en"))
          : null,
      );
      for (const track of Array.from(video.textTracks))
        track.mode =
          value && track.language.startsWith("en") ? "showing" : "disabled";
      emit("tracks");
    },
    destroy() {
      if (disposal) return disposal;
      disposed = true;
      ++generation;
      listeners.clear();
      nativeEvents.forEach((name) => video.removeEventListener(name, native));
      video.pause();
      disposal = releasePlayer()
        .catch(() => {})
        .then(() => {
          video.removeAttribute("src");
          video.load();
        });
      return disposal;
    },
  };
}
