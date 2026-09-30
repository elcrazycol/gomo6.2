/**
 * Link builders for the public-number URLs (docs/wiki/PUBLIC_IDS.md).
 *
 * A row's URL parameter is its public number when the API sent one, and its UUID
 * otherwise. The UUID fallback is load-bearing during the rollout: the React
 * Query cache can still hold payloads fetched before public_id existed, and a
 * missing number must degrade to the legacy UUID link — never to
 * /profile/undefined.
 *
 * Authorization is unaffected: public_id is a display/resolve alias only, the
 * backend gates every read on the row's UUID.
 */

/** A public number as it arrives from the API. */
export type PublicId = number | null | undefined;

/** Anything addressable by URL: a UUID plus (once the backend sends it) a number. */
export interface Identifiable {
  id?: string | null;
  public_id?: PublicId;
}

/**
 * isPublicId reports whether a route parameter is a public number (the same
 * shape the backend accepts: digits, no leading zero). Used by the data hooks to
 * pick the `public_id=eq.` filter instead of `id=eq.`.
 */
export const isPublicId = (value: string | null | undefined): boolean =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value);

/**
 * entityParam returns the URL parameter for a row: its public number, else its
 * UUID, else an empty string when the row carries neither.
 */
export const entityParam = (row: Identifiable | null | undefined): string => {
  if (row && typeof row.public_id === 'number' && Number.isFinite(row.public_id)) {
    return String(row.public_id);
  }
  return row?.id ?? '';
};

/** profileUrl builds /profile/<number-or-uuid>. */
export const profileUrl = (user: Identifiable | null | undefined): string => {
  const param = entityParam(user);
  return param ? `/profile/${param}` : '';
};

/**
 * threadUrl builds the thread URL, matching the app's routing convention:
 * a gomosub board lives under /g/<slug>/thread/<param>, a regular board under
 * /<slug>/thread/<param>, and a global topic (no board) under /thread/<param>.
 */
export const threadUrl = (
  thread: Identifiable | null | undefined,
  board?: { slug?: string | null; is_gomosub?: boolean | null } | null,
): string => {
  const param = entityParam(thread);
  if (!param) return '';
  const slug = board?.slug;
  if (!slug) return `/thread/${param}`;
  return `${board?.is_gomosub ? '/g' : ''}/${slug}/thread/${param}`;
};

/** wallPostUrl builds /profile/<owner>/wall/<post>. */
export const wallPostUrl = (
  owner: Identifiable | null | undefined,
  post: Identifiable | null | undefined,
): string => {
  const ownerParam = entityParam(owner);
  const postParam = entityParam(post);
  return ownerParam && postParam ? `/profile/${ownerParam}/wall/${postParam}` : '';
};

/**
 * profileLookupUrl builds the REST path that resolves a profile row from a route
 * parameter, picking the column that matches the parameter's shape.
 *
 * Hand-writing `?id=eq.<param>` is how a numeric URL used to 400: the parameter
 * is a public number on new links, and `id` is a UUID column. Use this (or the
 * hook) instead of building the query string inline.
 */
export const profileLookupUrl = (param: string | null | undefined): string => {
  const value = param ?? '';
  const column = isPublicId(value) ? 'public_id' : 'id';
  return `/api/v1/profiles?${column}=eq.${encodeURIComponent(value)}`;
};

/** threadLookupUrl is the same contract for the thread line. */
export const threadLookupUrl = (param: string | null | undefined): string => {
  const value = param ?? '';
  const column = isPublicId(value) ? 'public_id' : 'id';
  return `/api/v1/threads?${column}=eq.${encodeURIComponent(value)}`;
};
