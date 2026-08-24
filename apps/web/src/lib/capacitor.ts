/**
 * Native Capacitor shell bootstrap (iOS / Android).
 *
 * Runs only when the app is embedded in a Capacitor WebView
 * (Capacitor.isNativePlatform()); in the browser it is a no-op and the
 * visualViewport-based layer (lib/mobileKeyboard.ts) keeps owning the
 * keyboard. Inside the native shell the keyboard plugin owns the geometry
 * instead:
 *
 *  • `Keyboard.resize = "body"` (see capacitor.config.ts) resizes the iOS
 *    body around the soft keyboard while the layout viewport itself stays
 *    put — so the keyboard is accounted for manually by publishing the same
 *    CSS variables the app is already anchored to (messenger.css, index.css):
 *      --kb-inset — keyboard height in px (bottom of fixed/sticky bars)
 *      --app-vh   — visible viewport height in px (full-screen surfaces)
 *  • Classic Android (`windowSoftInputMode=adjustResize`) resizes the whole
 *    WebView instead, so the layout viewport already shrinks by the keyboard
 *    height. That is detected live (the viewport drops by ≈ the keyboard
 *    height between events) and --kb-inset is left at 0 in that case —
 *    otherwise the composer would float a second keyboard-height too high.
 *  • The iOS accessory bar (previous/next arrows + Done) is hidden — it is
 *    redundant for a chat composer.
 *  • The status bar style follows the device appearance, and the app state
 *    (background/foreground) re-syncs the keyboard geometry — a stale
 *    keyboard after returning from background is a classic native WebView
 *    bug.
 */
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";

/** True when running inside the Capacitor native shell (not the browser). */
export function isNativePlatform(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

/** Idempotent. Call once from the app entry point. Returns a dispose fn. */
export function initCapacitor(): () => void {
  if (!isNativePlatform()) return () => undefined;

  const root = document.documentElement;
  // Viewport height recorded at the last keyboard event — the baseline for
  // detecting an adjustResize-style WebView shrink (see syncKeyboardGeometry).
  let lastViewportHeight = window.innerHeight;
  let lastKeyboardHeight = 0;

  const syncKeyboardGeometry = (keyboardHeight: number) => {
    const viewportHeight = window.innerHeight;
    const alreadyResized =
      keyboardHeight > 0 && lastViewportHeight - viewportHeight >= keyboardHeight * 0.7;
    const inset = alreadyResized || keyboardHeight <= 0 ? 0 : Math.round(keyboardHeight);
    root.style.setProperty("--kb-inset", `${inset}px`);
    root.style.setProperty("--app-vh", `${Math.round(viewportHeight - inset)}px`);
    lastViewportHeight = viewportHeight;
    lastKeyboardHeight = keyboardHeight;
  };

  const handles: Array<{ remove: () => void }> = [];

  // iOS accessory bar (prev/next arrows + Done) is redundant for a chat
  // composer — hide it (iPhone only; a no-op elsewhere).
  Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);

  Keyboard.addListener("keyboardWillShow", (info) => syncKeyboardGeometry(info.keyboardHeight)).then(
    (h) => handles.push(h),
  );
  Keyboard.addListener("keyboardDidShow", (info) => syncKeyboardGeometry(info.keyboardHeight)).then(
    (h) => handles.push(h),
  );
  Keyboard.addListener("keyboardWillHide", () => syncKeyboardGeometry(0)).then((h) => handles.push(h));
  Keyboard.addListener("keyboardDidHide", () => syncKeyboardGeometry(0)).then((h) => handles.push(h));

  StatusBar.setStyle({ style: Style.Default }).catch(() => undefined);

  // Returning from the background can leave a stale keyboard geometry (and a
  // keyboard that the OS already dismissed) — re-sync with the last known
  // state so the shell snaps back correctly.
  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) syncKeyboardGeometry(lastKeyboardHeight);
  }).then((h) => handles.push(h));

  // Seed the CSS variables so full-screen surfaces are sized correctly before
  // the first keyboard event (and before the web keyboard layer would have).
  syncKeyboardGeometry(0);

  return () => {
    for (const handle of handles) handle.remove();
  };
}
