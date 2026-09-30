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
 * threadUrl builds the thread URL. With a board slug it is the pretty
 * /g/<slug>/thread/<param> form (board pages and gomosubs), otherwise the
 * global-topic /thread/<param>.
 */
export const threadUrl = (
  thread: Identifiable | null | undefined,
  board?: { slug?: string | null } | null,
): string => {
  const param = entityParam(thread);
  if (!param) return '';
  const slug = board?.slug;
  return slug ? `/g/${slug}/thread/${param}` : `/thread/${param}`;
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
