import type {
  LessonMetadata,
  LessonProgress,
  PlaybackAuthorization,
} from "@/lib/learning-api";
import type {
  PlayerAdapter,
  PlaybackEvent,
  PlaybackSnapshot,
} from "@/lib/player-adapter";
export const progress: LessonProgress = {
  user_id: "u",
  lesson_id: "l1",
  playback_session_id: "s",
  resume_position_seconds: 0,
  watched_intervals: [],
  watched_seconds: 0,
  watch_percent: 0,
  passed_prompt_ids: [],
  pending_prompt_id: null,
  completed: false,
  completed_at: null,
  updated_at: "2026-09-07T00:00:00Z",
};
export const lesson: LessonMetadata = {
  id: "l1",
  course_id: "c1",
  title: "Reading market structure",
  duration_seconds: 60,
  captions: {
    language: "en",
    label: "English",
    url: "https://example.test/en.vtt",
  },
  segments: [
    {
      id: "s1",
      title: "The opening",
      description: "Find the first swing.",
      start_seconds: 0,
      end_seconds: 20,
      thumbnail: { time_seconds: 2, url: "https://example.test/one.jpg" },
      required_prompt: {
        id: "q1",
        question: "Which point is the swing high?",
        options: [
          { id: "a", text: "The highest point" },
          { id: "b", text: "The lowest point" },
        ],
      },
    },
    {
      id: "s2",
      title: "The next move",
      description: "Follow the trend.",
      start_seconds: 20,
      end_seconds: 60,
      thumbnail: { time_seconds: 25, url: "https://example.test/two.jpg" },
      required_prompt: null,
    },
  ],
  progress,
};
export const authorization: PlaybackAuthorization = {
  playback_session_id: "s",
  resume_position_seconds: 0,
  pending_prompt_id: null,
  playback_id: "p",
  manifest_url: "https://example.test/hls?token=private",
  widevine_license_url: "wv",
  playready_license_url: "pr",
  fairplay_license_url: "fp",
  fairplay_certificate_url: "cert",
  playback_token: "private",
  drm_token: "private",
  expires_at: "2099-01-01T00:00:00Z",
};
export class FakePlayer implements PlayerAdapter {
  state: PlaybackSnapshot = {
    position: 0,
    duration: 60,
    paused: true,
    ended: false,
    buffering: false,
    volume: 1,
    playbackRate: 1,
    muted: false,
    captionsAvailable: true,
    captionsEnabled: false,
    seekableStart: 0,
    seekableEnd: 60,
  };
  listeners = new Set<(e: PlaybackEvent) => void>();
  destroyed = false;
  emit(
    type = "timeupdate",
    changes: Partial<PlaybackSnapshot> = {},
    error?: PlaybackEvent["error"],
  ) {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners)
      listener({ type, snapshot: this.snapshot(), error });
  }
  snapshot() {
    return { ...this.state };
  }
  subscribe(cb: (e: PlaybackEvent) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  async load(_source: PlaybackAuthorization, start: number) {
    this.emit("ready", { position: start, paused: true });
  }
  async play() {
    this.emit("play", { paused: false });
  }
  pause() {
    if (!this.state.paused) this.emit("pause", { paused: true });
  }
  seek(position: number) {
    this.emit("seeking", { position });
    this.emit("seeked");
  }
  setVolume(volume: number) {
    this.emit("volumechange", { volume });
  }
  setPlaybackRate(playbackRate: number) { this.emit("ratechange", { playbackRate }); }
  setMuted(muted: boolean) {
    this.emit("volumechange", { muted });
  }
  setCaptions(captionsEnabled: boolean) {
    this.emit("tracks", { captionsEnabled });
  }
  capabilities() {
    return { fullscreen: false, drm: "unknown" as const };
  }
  async destroy() {
    this.destroyed = true;
    this.listeners.clear();
  }
}
