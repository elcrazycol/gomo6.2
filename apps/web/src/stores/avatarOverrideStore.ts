import { create } from "zustand";

/**
 * Local (optimistic) avatar overrides keyed by user id.
 *
 * When an avatar upload starts, the freshly picked image/video is shown
 * everywhere that user's avatar appears — long before the server round-trip
 * and the cache invalidation that follows it. `UserAvatar` consults this map
 * when it is given a `userId`, so the new avatar is instant across the app.
 *
 * A value is either a `blob:` URL of the in-memory pick (while the upload is
 * in flight) or the storage key the server returned (after success, so the
 * blob can be revoked). Entries live for the session; a new upload replaces
 * the old one and a failed one clears it, restoring the cached avatar.
 */
export type AvatarOverride = {
  url: string;
  /** Explicit animated flag; when omitted the URL extension decides. */
  animated?: boolean;
};

type AvatarOverrideState = {
  overrides: Record<string, AvatarOverride>;
  setAvatarOverride: (userId: string, override: AvatarOverride) => void;
  clearAvatarOverride: (userId: string) => void;
};

export const useAvatarOverrideStore = create<AvatarOverrideState>((set) => ({
  overrides: {},
  setAvatarOverride: (userId, override) =>
    set((state) => ({ overrides: { ...state.overrides, [userId]: override } })),
  clearAvatarOverride: (userId) =>
    set((state) => {
      if (!state.overrides[userId]) return state;
      const next = { ...state.overrides };
      delete next[userId];
      return { overrides: next };
    }),
}));

/** Whether a `blob:`/`data:` URL is one of our session-local previews. */
export const isLocalAvatarUrl = (url: string | undefined): boolean =>
  !!url && /^(blob:|data:)/i.test(url);
