import { describe, it, expect, vi } from "vitest";
import {
  acquireStudyWakeLock,
  clearStudyBadge,
  createVadState,
  DEFAULT_VAD_OPTIONS,
  dictationCaptureMode,
  ensureReplyNotificationPermission,
  mediaRecorderSupported,
  notifyReplyDone,
  releaseStudyWakeLock,
  replyNotificationPermission,
  rmsOf,
  setStudyBadge,
  shouldNotifyReplyDone,
  vadSupported,
  vadUpdate,
  vibrateSupported,
  vibrateTick,
  wakeLockSupported,
  waveformBars,
  LONG_REPLY_MIN_CHARS,
} from "./studyMedia";

describe("wake lock", () => {
  it("detects support structurally", () => {
    expect(wakeLockSupported({ wakeLock: { request: async () => ({}) } })).toBe(
      true,
    );
    expect(wakeLockSupported({})).toBe(false);
    expect(wakeLockSupported(null)).toBe(false);
    expect(wakeLockSupported({ wakeLock: {} })).toBe(false);
  });

  it("acquires and releases, null where unsupported or denied", async () => {
    const release = vi.fn();
    const nav = { wakeLock: { request: vi.fn(async () => ({ release })) } };
    const handle = await acquireStudyWakeLock(nav);
    expect(nav.wakeLock.request).toHaveBeenCalledWith("screen");
    expect(handle).not.toBeNull();
    releaseStudyWakeLock(handle);
    expect(release).toHaveBeenCalledTimes(1);
    releaseStudyWakeLock(handle);
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => releaseStudyWakeLock(null)).not.toThrow();

    expect(await acquireStudyWakeLock({})).toBeNull();
    expect(
      await acquireStudyWakeLock({
        wakeLock: { request: async () => Promise.reject(new Error("denied")) },
      }),
    ).toBeNull();
  });
});

describe("rmsOf", () => {
  it("measures energy, 0 for empty or silent", () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0, 0, 0])).toBe(0);
    expect(rmsOf([1, -1])).toBe(1);
    expect(rmsOf([0.5, 0.5])).toBeCloseTo(0.5);
  });
});

describe("capture mode", () => {
  it("prefers VAD, falls back to fixed recording, then none", () => {
    expect(dictationCaptureMode(true, true)).toBe("vad");
    expect(dictationCaptureMode(false, true)).toBe("fixed");
    expect(dictationCaptureMode(false, false)).toBe("none");
  });

  it("probes VAD and recorder support", () => {
    expect(
      vadSupported({
        audioContext: function AudioContext() {},
        getUserMedia: () => {},
      }),
    ).toBe(true);
    expect(vadSupported({ audioContext: null, getUserMedia: () => {} })).toBe(
      false,
    );
    expect(vadSupported({ audioContext: function AudioContext() {} })).toBe(
      false,
    );
    expect(vadSupported({})).toBe(false);
    expect(mediaRecorderSupported(function MediaRecorder() {})).toBe(true);
    expect(mediaRecorderSupported(null)).toBe(false);
  });
});

describe("vadUpdate", () => {
  it("starts on threshold speech and ends after the hangover", () => {
    const state = createVadState();
    const opts = { ...DEFAULT_VAD_OPTIONS };
    expect(vadUpdate(state, 0.001, 0, opts)).toBeNull();
    expect(vadUpdate(state, 0.05, 100, opts)).toBe("speech-start");
    // Loud again: no repeat start, hangover clock cleared.
    expect(vadUpdate(state, 0.05, 200, opts)).toBeNull();
    // Silence starts the hangover, then ends the utterance.
    expect(vadUpdate(state, 0.001, 300, opts)).toBeNull();
    expect(
      vadUpdate(state, 0.001, 300 + opts.endHangoverMs - 1, opts),
    ).toBeNull();
    expect(vadUpdate(state, 0.001, 300 + opts.endHangoverMs, opts)).toBe(
      "speech-end",
    );
    expect(state.phase).toBe("idle");
  });

  it("tolerates pauses shorter than the hangover", () => {
    const state = createVadState();
    const opts = { ...DEFAULT_VAD_OPTIONS };
    vadUpdate(state, 0.05, 0, opts);
    vadUpdate(state, 0.001, 100, opts);
    // Speech resumes: the hangover clock resets, no end emitted.
    expect(vadUpdate(state, 0.05, 200, opts)).toBeNull();
    expect(vadUpdate(state, 0.001, 300, opts)).toBeNull();
    expect(vadUpdate(state, 0.001, 300 + opts.endHangoverMs, opts)).toBe(
      "speech-end",
    );
  });
});

describe("waveformBars", () => {
  it("tapers the ends and scales with level", () => {
    const full = waveformBars(1, 5);
    expect(full).toHaveLength(5);
    expect(full[2]).toBeCloseTo(1);
    expect(full[0]).toBeLessThan(full[1] ?? 1);
    expect(full[0]).toBeCloseTo(full[4] ?? 0);
    expect(waveformBars(0, 5)).toEqual([0, 0, 0, 0, 0]);
    const half = waveformBars(0.5, 5);
    for (let i = 0; i < full.length; i++) {
      expect(half[i]).toBeCloseTo((full[i] ?? 0) / 2);
    }
  });

  it("clamps level and handles degenerate bars", () => {
    expect(waveformBars(2, 3)).toEqual(waveformBars(1, 3));
    expect(waveformBars(-1, 3)).toEqual([0, 0, 0]);
    expect(waveformBars(1, 0)).toEqual([]);
    expect(waveformBars(1, 1)).toEqual([1]);
  });
});

describe("shouldNotifyReplyDone", () => {
  const long = "x".repeat(LONG_REPLY_MIN_CHARS);
  it("fires for long backgrounded granted replies", () => {
    expect(
      shouldNotifyReplyDone({
        hidden: true,
        focused: false,
        permission: "granted",
        replyChars: long.length,
      }),
    ).toBe(true);
    expect(
      shouldNotifyReplyDone({
        hidden: false,
        focused: false,
        permission: "granted",
        replyChars: long.length,
      }),
    ).toBe(true);
  });

  it("stays silent when focused, short, or unpermitted", () => {
    expect(
      shouldNotifyReplyDone({
        hidden: false,
        focused: true,
        permission: "granted",
        replyChars: long.length,
      }),
    ).toBe(false);
    expect(
      shouldNotifyReplyDone({
        hidden: true,
        focused: false,
        permission: "granted",
        replyChars: 10,
      }),
    ).toBe(false);
    expect(
      shouldNotifyReplyDone({
        hidden: true,
        focused: false,
        permission: "default",
        replyChars: long.length,
      }),
    ).toBe(false);
    expect(
      shouldNotifyReplyDone({
        hidden: true,
        focused: false,
        permission: "denied",
        replyChars: long.length,
      }),
    ).toBe(false);
  });
});

describe("notification wrappers", () => {
  function notifCtor(
    permission: string,
    requestPermission?: () => Promise<string>,
  ) {
    const ctor = vi.fn();
    return Object.assign(ctor, { permission, requestPermission });
  }

  it("reads permission, unsupported without a ctor", () => {
    expect(replyNotificationPermission(notifCtor("granted"))).toBe("granted");
    expect(replyNotificationPermission(undefined)).toBe("unsupported");
  });

  it("asks only when undecided", async () => {
    expect(await ensureReplyNotificationPermission(notifCtor("granted"))).toBe(
      "granted",
    );
    const ask = notifCtor("default", async () => "granted");
    expect(await ensureReplyNotificationPermission(ask)).toBe("granted");
    expect(await ensureReplyNotificationPermission(undefined)).toBe(
      "unsupported",
    );
  });

  it("notifies only through the gate, never throws", () => {
    const ctor = notifCtor("granted");
    const body = "y".repeat(LONG_REPLY_MIN_CHARS);
    expect(
      notifyReplyDone("Reply finished", body, { notif: ctor, hidden: true }),
    ).toBe(true);
    expect(ctor).toHaveBeenCalledTimes(1);
    // Focused: silent.
    expect(
      notifyReplyDone("Reply finished", body, {
        notif: ctor,
        hidden: false,
        focused: true,
      }),
    ).toBe(false);
    // Short: silent.
    expect(
      notifyReplyDone("Reply finished", "short", { notif: ctor, hidden: true }),
    ).toBe(false);
    // Unpermitted: silent.
    expect(
      notifyReplyDone("Reply finished", body, {
        notif: notifCtor("default"),
        hidden: true,
      }),
    ).toBe(false);
    // Unsupported: silent.
    expect(
      notifyReplyDone("Reply finished", body, {
        notif: undefined,
        hidden: true,
      }),
    ).toBe(false);
  });
});

describe("badging", () => {
  it("sets and clears where supported, false elsewhere", () => {
    const setAppBadge = vi.fn();
    const clearAppBadge = vi.fn();
    expect(setStudyBadge(1, { setAppBadge })).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(1);
    expect(clearStudyBadge({ clearAppBadge })).toBe(true);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    expect(setStudyBadge(1, {})).toBe(false);
    expect(clearStudyBadge(null)).toBe(false);
  });
});

describe("vibrate", () => {
  it("ticks where supported, no-ops elsewhere", () => {
    const vibrate = vi.fn();
    expect(vibrateSupported({ vibrate })).toBe(true);
    expect(vibrateTick(8, { vibrate })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(8);
    expect(vibrateSupported({})).toBe(false);
    expect(vibrateTick(8, {})).toBe(false);
    expect(vibrateTick(8, null)).toBe(false);
    expect(
      vibrateTick(8, {
        vibrate: () => {
          throw new Error("nope");
        },
      }),
    ).toBe(false);
  });
});
