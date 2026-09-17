import * as learningApi from "./learning-api";
import type {
  LessonMetadata,
  LessonProgress,
  LessonPrompt,
  PlaybackAuthorization,
} from "./learning-api";
import type {
  PlayerAdapter,
  PlaybackSnapshot,
  PlaybackEvent,
} from "./player-adapter";
export type LessonApi = Pick<
  typeof learningApi,
  "getLesson" | "authorizePlayback" | "saveProgress" | "submitAttempt"
>;
export type LessonView = {
  snapshot: PlaybackSnapshot;
  progress: LessonProgress;
  prompt: LessonPrompt | null;
  feedback: string;
  correct: boolean;
  busy: boolean;
  ready: boolean;
  error: string | null;
  seekWarning: boolean;
  seekNotice: number | null;
  seekBlocked: boolean;
  seekableUntil: number;
};

// The browser gate is a learning interaction. The backend alone approves progress.
export class LessonController {
  private disposed = false;
  private source: PlaybackAuthorization;
  private refreshed = false;
  private refreshing = false;
  private correcting = false;
  private observedStart: number;
  private lastPosition: number;
  private furthestWatched: number;
  private lastTime = Date.now();
  private serial: Promise<void> = Promise.resolve();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: () => void;
  private state: LessonView;
  constructor(
    private lesson: LessonMetadata,
    source: PlaybackAuthorization,
    private adapter: PlayerAdapter,
    private api: LessonApi,
    private update: (state: LessonView) => void,
    private unauthorized: () => void,
  ) {
    this.source = source;
    this.observedStart = source.resume_position_seconds;
    this.lastPosition = source.resume_position_seconds;
    this.furthestWatched = Math.max(
      source.resume_position_seconds,
      lesson.progress.resume_position_seconds,
      ...lesson.progress.watched_intervals.map((interval) => interval[1]),
    );
    this.state = {
      snapshot: adapter.snapshot(),
      progress: lesson.progress,
      prompt: null,
      feedback: "",
      correct: false,
      busy: false,
      ready: false,
      error: null,
      seekWarning: false,
      seekNotice: null,
      seekBlocked: false,
      seekableUntil: this.furthestWatched,
    };
    this.unsubscribe = adapter.subscribe((event) => this.onEvent(event));
  }
  private publish(patch: Partial<LessonView> = {}) {
    if (!this.disposed) {
      this.state = {
        ...this.state,
        ...patch,
        seekableUntil: this.furthestWatched,
        snapshot: this.adapter.snapshot(),
      };
      this.update(this.state);
    }
  }
  private gate() {
    return this.lesson.segments.find(
      (s) =>
        s.required_prompt &&
        !this.state.progress.passed_prompt_ids.includes(s.required_prompt.id),
    );
  }
  private prompt(id: string | null) {
    return (
      this.lesson.segments.find((s) => s.required_prompt?.id === id)
        ?.required_prompt ?? null
    );
  }
  async start() {
    this.heartbeat = setInterval(() => {
      if (Date.now() >= Date.parse(this.source.expires_at)) {
        void this.refresh();
        return;
      }
      if (this.state.ready && !this.refreshing) void this.flush();
    }, 4000);
    try {
      await this.adapter.load(
        this.source,
        this.source.resume_position_seconds,
        this.lesson.captions,
      );
      if (this.disposed) return;
      this.publish({
        ready: true,
        prompt: this.prompt(this.source.pending_prompt_id),
      });
      if (this.source.pending_prompt_id) this.adapter.pause();
    } catch {
      if (!this.refreshing)
        this.publish({
          error: "Secure playback is unavailable. Please retry.",
        });
    }
  }
  private onEvent(event: PlaybackEvent) {
    if (this.disposed || this.correcting) return;
    if (event.error) {
      this.adapter.pause();
      if (event.error.category === "authorization") void this.refresh();
      else this.publish({ error: event.error.message });
      return;
    }
    const position = event.snapshot.position;
    if (this.state.seekWarning) {
      if (position !== this.lastPosition) this.move(this.lastPosition);
      if (!this.adapter.snapshot().paused) this.adapter.pause();
      return;
    }
    if (event.type === "seeking" && position > this.furthestWatched) {
      this.move(this.furthestWatched);
      this.publish({ seekBlocked: true });
      return;
    }
    if (event.type === "timeupdate") {
      const delta = position - this.lastPosition;
      const elapsed = (Date.now() - this.lastTime) / 1000;
      const naturalAdvance =
        !event.snapshot.paused &&
        delta >= 0 &&
        delta <=
          Math.max(
            2,
            elapsed * event.snapshot.playbackRate * 1.5 + 1,
          );
      if (naturalAdvance)
        this.furthestWatched = Math.max(this.furthestWatched, position);
    }
    const gate = this.gate();
    if (gate && position >= gate.end_seconds && !this.state.prompt) {
      if (
        event.type === "seeking" ||
        position - this.lastPosition >
          Math.max(2, ((Date.now() - this.lastTime) / 1000) * event.snapshot.playbackRate * 1.5 + 1)
      )
        this.observedStart = gate.end_seconds;
      this.openGate(gate.end_seconds, gate.required_prompt!);
      return;
    }
    if (
      this.state.prompt &&
      !this.state.correct &&
      gate &&
      position > gate.end_seconds
    ) {
      this.move(gate.end_seconds);
      this.adapter.pause();
      return;
    }
    if (event.type === "seeking") {
      void this.flush(this.lastPosition);
      this.observedStart = position;
    } else if (event.type === "timeupdate") {
      const delta = position - this.lastPosition;
      const elapsed = (Date.now() - this.lastTime) / 1000;
      // Seeks, suspended tabs, and long gaps are never credited as watched time.
      if (
        delta < 0 ||
        delta > Math.max(2, elapsed * event.snapshot.playbackRate * 1.5 + 1) ||
        position - this.observedStart > 15
      )
        this.observedStart = position;
    }
    this.lastPosition = position;
    this.lastTime = Date.now();
    this.publish();
    if (event.type === "pause" || event.type === "ended") void this.flush();
  }
  private move(position: number) {
    this.correcting = true;
    this.adapter.seek(position);
    this.correcting = false;
    this.lastPosition = position;
    this.observedStart = position;
    this.lastTime = Date.now();
    this.publish();
  }
  private openGate(boundary: number, prompt: LessonPrompt) {
    this.correcting = true;
    this.adapter.pause();
    this.adapter.seek(boundary);
    this.correcting = false;
    this.lastPosition = boundary;
    // A boundary reached by a jump carries no watch credit.
    if (boundary - this.observedStart > 15) this.observedStart = boundary;
    this.publish({ prompt, feedback: "", correct: false });
    void this.flush(boundary);
  }
  seek(position: number) {
    if (
      !Number.isFinite(position) ||
      this.state.prompt ||
      this.state.seekWarning ||
      !this.state.ready ||
      this.refreshing
    )
      return;
    const allowed = Math.max(
      0,
      Math.min(this.lesson.duration_seconds, position),
    );
    if (allowed > this.furthestWatched) {
      this.move(this.furthestWatched);
      this.publish({ seekBlocked: true });
      return;
    }
    const gate = this.gate();
    this.publish({ seekBlocked: false });
    void this.flush(this.lastPosition);
    this.observedStart = allowed;
    if (gate && allowed >= gate.end_seconds) {
      this.observedStart = gate.end_seconds;
      this.openGate(gate.end_seconds, gate.required_prompt!);
    } else {
      this.move(allowed);
    }
  }
  dismissSeekNotice(notice: number) {
    if (this.state.seekNotice === notice) this.publish({ seekNotice: null });
  }
  dismissSeekBlocked() {
    if (this.state.seekBlocked) this.publish({ seekBlocked: false });
  }
  async acknowledgeSeekWarning() {
    if (!this.state.seekWarning) return;
    this.publish({ seekWarning: false });
    await this.togglePlay();
  }
  async togglePlay() {
    if (
      this.state.seekWarning ||
      this.state.prompt ||
      !this.state.ready ||
      this.refreshing ||
      this.state.error
    )
      return;
    if (!this.adapter.snapshot().paused) this.adapter.pause();
    else
      try {
        await this.adapter.play();
      } catch {
        this.publish({ error: "Playback could not start. Please retry." });
      }
  }
  pause() {
    this.adapter.pause();
  }
  setMuted(value: boolean) {
    this.adapter.setMuted(value);
  }
  setVolume(value: number) {
    this.adapter.setVolume(value);
  }
  setPlaybackRate(value: number) {
    if (!Number.isFinite(value) || value < 0.5 || value > 2) return;
    void this.flush();
    this.adapter.setPlaybackRate(value);
    this.publish();
  }
  setCaptions(value: boolean) {
    this.adapter.setCaptions(value);
  }
  private flush(position = this.adapter.snapshot().position): Promise<void> {
    if (this.disposed || this.refreshing) return this.serial;
    const end = Math.max(
      0,
      Math.min(
        position,
        this.gate()?.end_seconds ?? this.lesson.duration_seconds,
      ),
    );
    const start =
      this.observedStart <= end && end - this.observedStart <= 15
        ? this.observedStart
        : end;
    this.observedStart = end;
    const session = this.source.playback_session_id;
    const operation = async () => {
      if (this.disposed) return;
      try {
        const progress = await this.api.saveProgress(this.lesson.id, {
          playback_session_id: session,
          position_seconds: end,
          start_seconds: start,
          end_seconds: end,
        });
        if (this.disposed || session !== this.source.playback_session_id)
          return;
        this.publish({ progress });
        if (progress.resume_position_seconds < end) {
          this.adapter.pause();
          this.move(progress.resume_position_seconds);
        }
        if (progress.pending_prompt_id && !this.state.prompt) {
          this.adapter.pause();
          this.publish({
            prompt: this.prompt(progress.pending_prompt_id),
            correct: false,
            feedback: "",
          });
        }
      } catch (error) {
        await this.reconcile(error);
      }
    };
    this.serial = this.serial.then(operation, operation);
    return this.serial;
  }
  private async reconcile(error: unknown) {
    this.adapter.pause();
    if (error instanceof learningApi.LearningApiError && error.status === 401) {
      this.unauthorized();
      return;
    }
    try {
      const latest = await this.api.getLesson(this.lesson.id);
      if (this.disposed) return;
      this.move(latest.progress.resume_position_seconds);
      this.publish({
        progress: latest.progress,
        prompt: this.prompt(latest.progress.pending_prompt_id),
        error: "Your progress was refreshed. Please retry playback.",
      });
    } catch {
      this.publish({ error: "Secure playback is unavailable. Please retry." });
    }
  }
  async answer(option: string) {
    const prompt = this.state.prompt;
    if (!prompt || this.state.busy || this.state.correct) return;
    this.publish({ busy: true });
    const operation = async () => {
      try {
        if (this.disposed) return;
        const result = await this.api.submitAttempt(this.lesson.id, prompt.id, {
          playback_session_id: this.source.playback_session_id,
          option_id: option,
        });
        this.publish({
          progress: result.progress,
          feedback: result.feedback || result.explanation,
          correct: result.is_correct,
          busy: !result.is_correct && !result.retry_allowed,
        });
      } catch (error) {
        await this.reconcile(error);
        this.publish({ busy: false });
      }
    };
    this.serial = this.serial.then(operation, operation);
    await this.serial;
  }
  async continue() {
    if (!this.state.correct) return;
    this.publish({ prompt: null, correct: false, feedback: "" });
    try {
      await this.adapter.play();
    } catch {
      this.publish({ error: "Playback could not start. Please retry." });
    }
  }
  private async refresh() {
    if (this.disposed || this.refreshing) return;
    this.adapter.pause();
    if (this.refreshed) {
      this.publish({
        error: "Secure playback needs a new session. Please retry.",
      });
      return;
    }
    this.refreshed = true;
    this.refreshing = true;
    this.publish({ ready: false, error: null });
    try {
      await this.serial;
      const source = await this.api.authorizePlayback(this.lesson.id);
      if (this.disposed) return;
      this.source = source;
      const latest = await this.api.getLesson(this.lesson.id);
      if (this.disposed) return;
      this.observedStart = source.resume_position_seconds;
      this.lastPosition = source.resume_position_seconds;
      this.furthestWatched = Math.max(
        source.resume_position_seconds,
        latest.progress.resume_position_seconds,
        ...latest.progress.watched_intervals.map((interval) => interval[1]),
      );
      await this.adapter.load(
        source,
        source.resume_position_seconds,
        this.lesson.captions,
      );
      this.publish({
        progress: latest.progress,
        prompt: this.prompt(source.pending_prompt_id),
        ready: true,
      });
    } catch (error) {
      if (error instanceof learningApi.LearningApiError && error.status === 401)
        this.unauthorized();
      else
        this.publish({
          error: "Secure playback is unavailable. Please retry.",
        });
    } finally {
      this.refreshing = false;
    }
  }
  destroy() {
    this.disposed = true;
    clearInterval(this.heartbeat);
    this.unsubscribe();
    void this.adapter.destroy();
  }
}
