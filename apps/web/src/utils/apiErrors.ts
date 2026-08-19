import i18n from "@/i18n";
import type { TFunction } from "i18next";

/** The shape of an error produced by the API client or the auth compat layer. */
export interface ApiErrorLike {
  code?: string;
  params?: unknown;
  message?: string;
}

/**
 * Render a backend API error locally. When the error carries a stable `code`,
 * resolve it through the `error.<code>` i18next key (with `params` for
 * interpolation). Otherwise fall back to the raw message, then to a localized
 * generic fallback key.
 */
export function apiErrorMessage(
  err: unknown,
  t: TFunction,
  fallbackKey = "error.generic"
): string {
  const e = err as ApiErrorLike | null | undefined;
  const code = e?.code;
  if (code && i18n.exists(`error.${code}`)) {
    return t(`error.${code}`, (e?.params as Record<string, unknown>) ?? undefined);
  }
  const message = e?.message;
  if (message && !message.startsWith("HTTP ")) {
    return message;
  }
  return t(fallbackKey);
}
