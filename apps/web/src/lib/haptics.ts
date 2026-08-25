/**
 * Cross-platform haptic feedback for touch interactions.
 *
 * Android (and any browser with the Vibration API): `navigator.vibrate` —
 * the OS-level, battery-friendly haptic that respects the system "vibrate"
 * setting.
 *
 * iOS Safari has no Vibration API at all, so on iPhones the only way to
 * emulate a tap on the skin is a short, near-silent WebAudio click (~1 kHz,
 * tens of milliseconds, low gain, quick decay). The AudioContext is created
 * lazily on the first call: haptics are only ever fired from inside user
 * gestures (swipe end, long press), which is exactly when iOS allows the
 * context to start. If the context still ends up suspended, the tick is
 * skipped silently — never throw, never log.
 */
let audioCtx: AudioContext | null = null;

type AudioWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as AudioWindow;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    // Created outside a user gesture → iOS keeps it suspended. Try to resume;
    // if it never runs, the tick is a silent no-op.
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

function audioTick(freqHz: number, durationMs: number, gain: number, delayMs = 0): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freqHz;
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

/** One short pulse — e.g. the long-press "context menu armed" cue. */
export function hapticTick(strengthMs = 8): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(strengthMs);
    return;
  }
  audioTick(1200, 35, 0.12);
}

/**
 * The "reply created" cue — deliberately understated:
 *  • Android: ONE barely-perceptible brush (4ms; the OS-level haptic already
 *    respects the system vibration setting);
 *  • iOS Safari: the same confirmation but very quiet — low gain so it reads
 *    as a light skin tap instead of a notification blip.
 */
export function hapticSuccess(): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(4);
    return;
  }
  audioTick(1180, 40, 0.02);
  audioTick(980, 45, 0.02, 70);
}