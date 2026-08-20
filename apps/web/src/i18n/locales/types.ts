// Typed shape of the locale resources. Every namespace is a flat map of
// string keys. Keys with plural forms carry the `_one/_few/_many/_other`
// suffixes i18next understands; they are typed as strings so the `t()` calls
// stay ergonomic.

export interface LocaleResources {
  common: Record<string, string>;
  nav: Record<string, string>;
  auth: Record<string, string>;
  settings: Record<string, string>;
  time: Record<string, string>;
  notif: Record<string, string>;
  error: Record<string, string>;
  tags: Record<string, string>;
  board: Record<string, string>;
  thread: Record<string, string>;
  profile: Record<string, string>;
  share: Record<string, string>;
}

export type LocaleNamespace = keyof LocaleResources;
