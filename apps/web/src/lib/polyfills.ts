// ─── ES2022 API polyfills ────────────────────────────────────────────────────
//
// Some bundled dependencies (e.g. @tanstack/react-virtual, which powers the
// messenger message list) call `Object.hasOwn()`. That API landed in ES2022
// and is missing on older mobile browsers / WebViews (iOS Safari < 15.4,
// older Android). Without a polyfill the messenger crashes on open with
// "Object.hasOwn is not a function".
//
// This module must be imported FIRST in the app entry point so the polyfill is
// installed before any dependency code runs.

export function installObjectHasOwnPolyfill(): void {
  if (typeof (Object as { hasOwn?: unknown }).hasOwn === "function") {
    return;
  }
  Object.defineProperty(Object, "hasOwn", {
    value: function hasOwn(object: object, key: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(object, key);
    },
    writable: true,
    configurable: true,
  });
}

installObjectHasOwnPolyfill();
