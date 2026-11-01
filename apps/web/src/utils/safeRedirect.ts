/** Same-origin absolute path only.
 *
 * A naive `startsWith("/")` check lets `//evil.com` (protocol-relative →
 * external) and backslash variants through, turning every login link into a
 * phishing primitive. This gate is used for post-login `?redirect=` targets.
 */
export function isSafeRedirect(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  // Reject control characters that could confuse routers or log viewers.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  return true;
}
