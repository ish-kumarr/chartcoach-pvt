import type { PlayerAdapter, PlaybackEvent, PlaybackSnapshot } from "./player-adapter";

export function createLocalPlayerAdapter(video: HTMLVideoElement): PlayerAdapter {
  const listeners = new Set<(event: PlaybackEvent) => void>();
  let disposed = false;
  let buffering = false;
  let cancelLoad: (() => void) | undefined;
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.srclang = "hi";
  track.label = "Hindi (auto-generated)";
  track.src = "/api/local-lecture/captions.vtt";
  video.append(track);
  const snapshot = (): PlaybackSnapshot => ({
    position: video.currentTime || 0, duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused, ended: video.ended, buffering, volume: video.volume, muted: video.muted, playbackRate: video.playbackRate,
    captionsAvailable: track.readyState === 2, captionsEnabled: track.track.mode === "showing",
    seekableStart: video.seekable.length ? video.seekable.start(0) : 0,
    seekableEnd: video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0,
  });
  const emit = (type: string) => {
    if (!disposed) listeners.forEach((listener) => listener({ type, snapshot: snapshot(), ...(type === "error" ? { error: { category: "media" as const, retryable: true, message: "The local lecture could not be loaded." } } : {}) }));
  };
  const handler = (event: Event) => {
    if (event.type === "waiting") buffering = true;
    if (["playing", "canplay", "pause", "seeked"].includes(event.type)) buffering = false;
    emit(event.type);
  };
  const events = ["play", "pause", "timeupdate", "seeking", "seeked", "ended", "volumechange", "ratechange", "waiting", "playing", "canplay", "error"];
  events.forEach((event) => video.addEventListener(event, handler));
  const trackLoaded = () => {
    for (const cue of Array.from(track.track.cues ?? [])) {
      if (cue instanceof VTTCue) cue.line = -4;
    }
    emit("tracks");
  };
  track.addEventListener("load", trackLoaded);
  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capabilities: () => ({ fullscreen: Boolean(video.requestFullscreen), drm: "unknown" }),
    async load(_source, start) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { video.removeEventListener("loadedmetadata", ready); video.removeEventListener("error", fail); cancelLoad = undefined; };
        const ready = () => { cleanup(); if (!disposed) { video.currentTime = Math.min(start, video.duration); emit("ready"); } resolve(); };
        const fail = () => { cleanup(); reject(new Error("Local media unavailable")); };
        cancelLoad = () => { cleanup(); resolve(); };
        video.addEventListener("loadedmetadata", ready);
        video.addEventListener("error", fail);
        video.src = "/api/local-lecture/video.mp4";
        track.track.mode = "hidden";
        video.load();
      });
    },
    async play() { if (!disposed) await video.play(); },
    pause() { if (!disposed) video.pause(); },
    seek(seconds) { if (!disposed) video.currentTime = seconds; },
    setVolume(value) { video.volume = Math.min(1, Math.max(0, value)); },
    setPlaybackRate(value) { if (!disposed && Number.isFinite(value) && value >= 0.5 && value <= 2) video.playbackRate = value; },
    setMuted(value) { video.muted = value; },
    setCaptions(value) { track.track.mode = value ? "showing" : "hidden"; emit("tracks"); },
    async destroy() {
      disposed = true;
      cancelLoad?.();
      events.forEach((event) => video.removeEventListener(event, handler));
      track.removeEventListener("load", trackLoaded);
      listeners.clear(); video.pause(); track.remove(); video.removeAttribute("src"); video.load();
    },
  };
}
