/**
 * The DOM event every profile mutation broadcasts.
 *
 * It lives in its own dependency-free module (rather than next to the cache it
 * invalidates) so listeners can import it without pulling in the profile data
 * layer — which also keeps test doubles for that layer minimal.
 *
 * Used by the dispatcher (utils/profileCustomization) and by
 * useProfileCustomization. A few older listeners (ProfileCacheContext,
 * currentUserMeta, the API query cache, ProfileHoverCard, useProfileInvalidation)
 * still spell the name out by hand; they should import this when next touched,
 * because a listener with a different literal silently never fires at all.
 */
export const PROFILE_CACHE_INVALIDATE_EVENT = 'profile-cache:invalidate';

/**
 * Event detail carried by `profile-cache:invalidate`. `userId` scopes the
 * invalidation to one profile (the server sends it with every profile_updated
 * broadcast); when absent the whole cache is reset (the editor's own save).
 */
export interface ProfileCacheInvalidateDetail {
  userId?: string;
}

/**
 * Reads the scoped user id out of a `profile-cache:invalidate` event, if any.
 * Centralised so every listener agrees on where the id lives — a listener that
 * looks in the wrong place silently treats a scoped event as a global reset.
 */
export const profileCacheInvalidateUserId = (event: Event): string | undefined =>
  (event as CustomEvent<ProfileCacheInvalidateDetail>).detail?.userId;
