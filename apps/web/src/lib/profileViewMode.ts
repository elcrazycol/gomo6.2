/**
 * Default profile view — the user picks in Settings → Appearance whether
 * profiles open in the regular social layout or already unfolded into the forum
 * layout. Stored in localStorage like the other appearance preferences
 * (theme, publish-button style, header behaviour).
 *
 * Profile.tsx reads it when a profile page mounts and applies it only on
 * desktop: the forum layout is desktop-only (there is no second column and no
 * hover on touch), so the preference is a no-op on narrow screens.
 */

export type ProfileViewMode = "social" | "forum";

export const PROFILE_VIEW_MODE_KEY = "profile-view-mode";

export const DEFAULT_PROFILE_VIEW_MODE: ProfileViewMode = "social";

/** Side the forum panel opens on when profiles default to the forum layout. */
export const DEFAULT_FORUM_SIDE: "left" | "right" = "left";

/** Broadcast so an already-open profile picks up the choice without a reload. */
export const PROFILE_VIEW_MODE_EVENT = "gomo6:profile-view-mode";

export const getProfileViewMode = (): ProfileViewMode => {
  const saved = localStorage.getItem(PROFILE_VIEW_MODE_KEY);
  return saved === "forum" || saved === "social" ? saved : DEFAULT_PROFILE_VIEW_MODE;
};

export const setProfileViewMode = (mode: ProfileViewMode): void => {
  localStorage.setItem(PROFILE_VIEW_MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent(PROFILE_VIEW_MODE_EVENT, { detail: { mode } }));
};
