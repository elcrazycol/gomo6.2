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
