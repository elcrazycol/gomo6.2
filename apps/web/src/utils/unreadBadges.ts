/**
 * Unread indicators that live outside the tab title.
 *
 * A title can only draw attention while the tab is actually visible — and the
 * old infinite blink made things worse: background tabs throttle timers to
 * >=1s (far more aggressively after a few minutes), so the rhythm was random
 * and irritating. These two channels survive a hidden tab:
 *
 *   - the favicon gets a red count badge (drawn once, no timer), and
 *   - an installed app gets the OS badge via the Badging API.
 *
 * Both are pure functions of the unread count: call `applyUnreadBadges(n)` on
 * every change and pass `0` to clear.
 */

const FAVICON_LINK_ID = "gomo6-unread-favicon";
// High-resolution app icon used if the page's own favicon cannot be decoded
// into a canvas (ICO support varies between browsers; the PNG never fails).
const FALLBACK_ICON_SRC = "/pwa-192x192.png";
const CANVAS_SIZE = 64;
const BADGE_BG = "#e5484d";

let baseIconPromise: Promise<HTMLImageElement | null> | null = null;
let renderToken = 0;

function ensureFaviconLink(): HTMLLinkElement {
  const existing = document.getElementById(FAVICON_LINK_ID) as HTMLLinkElement | null;
  if (existing) return existing;

  const link = document.createElement("link");
  link.id = FAVICON_LINK_ID;
  link.rel = "icon";
  link.type = "image/png";
  // Remember the icon the page shipped with so clearing the badge restores it.
  const shipped = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  ).find((el) => el.id !== FAVICON_LINK_ID);
  link.dataset.defaultHref = shipped?.getAttribute("href") || "/favicon.ico";
  link.href = link.dataset.defaultHref;
  document.head.appendChild(link);
  return link;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function loadBaseIcon(): Promise<HTMLImageElement | null> {
  if (!baseIconPromise) {
    const link = ensureFaviconLink();
    baseIconPromise = loadImage(link.dataset.defaultHref || "/favicon.ico").then(
      (img) => img ?? loadImage(FALLBACK_ICON_SRC),
    );
  }
  return baseIconPromise;
}

function drawCountBadge(ctx: CanvasRenderingContext2D, count: number): void {
  const label = count > 99 ? "99+" : String(count);
  const compact = label.length > 2;
  const radius = compact ? 27 : 23;
  const cx = CANVAS_SIZE - radius - 1;
  const cy = CANVAS_SIZE - radius - 1;

  // A white ring keeps the badge readable on any base artwork.
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = BADGE_BG;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${compact ? 28 : 34}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(label, cx, cy + 1);
}

async function renderFavicon(count: number): Promise<void> {
  const token = ++renderToken;
  const link = ensureFaviconLink();

  if (count <= 0) {
    link.href = link.dataset.defaultHref || "/favicon.ico";
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  // jsdom and ancient browsers have no 2D context — leave the icon alone.
  if (!ctx) return;

  const base = await loadBaseIcon();
  if (token !== renderToken) return; // a newer count superseded this render

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (base) ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawCountBadge(ctx, count);
  link.href = canvas.toDataURL("image/png");
}

function renderAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    const result = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    void result?.catch(() => {
      // Badging API is best-effort (unsupported, denied or not installed).
    });
  } catch {
    // Some engines throw synchronously instead of rejecting.
  }
}

/** Reflects the unread count on the favicon and the installed-app icon. */
export function applyUnreadBadges(count: number): void {
  if (typeof document === "undefined") return;
  void renderFavicon(count);
  renderAppBadge(count);
}
