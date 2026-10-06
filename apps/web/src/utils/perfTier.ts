/**
 * Rendering tier for the always-on glass header.
 *
 * A live `backdrop-filter` is the most expensive thing on the page: the browser
 * re-blurs everything behind the fixed header on every scroll frame. On weak
 * hardware that is the difference between a smooth scroll and a stutter, so we
 * classify the device once from cheap hints and let CSS drop the expensive
 * parts (`html.perf-lite`), then re-check the verdict against real frame pacing
 * during the first scroll in case the hints lied.
 *
 * The tier is one-way (full → lite): re-enabling the heavy blur on a device
 * that already stuttered would just make it stutter again.
 */
export type PerfTier = "full" | "lite";

const LITE_CLASS = "perf-lite";

/** Coarse, one-shot classification from cheap device hints. */
export function detectPerfTier(): PerfTier {
  if (typeof navigator === "undefined") return "full";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };

  // The user explicitly asked the browser to save data — respect it.
  if (nav.connection?.saveData) return "lite";
  // ≤4 GB RAM or ≤4 cores is nearly always a mobile / integrated GPU that
  // cannot afford a full-radius live blur.
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return "lite";
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4) return "lite";

  return "full";
}

export function applyPerfTier(tier: PerfTier): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(LITE_CLASS, tier === "lite");
}

/**
 * Measure real frame pacing while the user scrolls — the moment the glass
 * actually costs something — and downgrade if the device cannot hold a smooth
 * rate. Runs at most once and detaches itself.
 *
 * 40 frames is enough to judge (~0.7s of scrolling) and keeps the window short
 * so a slow device is caught before the user has scrolled far. The 75th
 * percentile decides, not the median: a device that stutters on a quarter of
 * frames is already unpleasant and the median would hide it.
 */
function sampleScrollPerformance(): void {
  if (typeof window === "undefined") return;

  const FRAMES = 40;
  const MIN_SAMPLES = 15;

  let armed = false;

  const onScroll = () => {
    if (armed) return;
    armed = true;

    let last = 0;
    let raf = 0;
    const deltas: number[] = [];

    const finish = () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      if (deltas.length < MIN_SAMPLES) return;
      const sorted = deltas.slice().sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      // >20ms at the 75th percentile ≈ a device that cannot hold ~50fps.
      if (p75 > 20) applyPerfTier("lite");
    };

    const tick = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (deltas.length < FRAMES) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      finish();
    };

    raf = window.requestAnimationFrame(tick);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
}

/** Call once at startup (see main.tsx). */
export function initPerfTier(): void {
  applyPerfTier(detectPerfTier());
  if (typeof document !== "undefined" && document.documentElement.classList.contains(LITE_CLASS)) {
    return;
  }
  sampleScrollPerformance();
}
