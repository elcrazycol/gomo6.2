import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { uploadFile } from "@/utils/storage";
import { apiErrorMessage } from "@/utils/apiErrors";
import { dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";
import { useFileDrop } from "@/hooks/useFileDrop";
import { openVideoEditor } from "@/stores/videoEditorStore";
import { isLocalAvatarUrl, useAvatarOverrideStore } from "@/stores/avatarOverrideStore";
import type { AvatarDragHandlers, AvatarHistoryItem, Profile } from "./types";

/** How long the completed ring lingers before the loader is removed (ms). */
const AVATAR_RING_DONE_MS = 450;

export interface UseProfileEditingParams {
  userId: string | undefined;
  profile: Profile | null;
  currentUser: { id: string } | null;
  /** setProfile passthrough — background edits (username, background, theme,
   * display name) patch the loaded row in place. */
  onProfileUpdate: (updater: (prev: Profile | null) => Profile | null) => void;
  /** Keeps the page's avatar display in sync (crop confirm, history delete). */
  onAvatarUrlChange: (url: string | null) => void;
  /** Nickname emoji changed: page keeps its copy in sync + refreshes the wall. */
  onNicknameEmojiChange: (emojiId: string | null) => void;
  /** Reload the profile row after saves that change it. */
  onReload: () => void;
  /** Avatar history reloader from useProfileData (crop confirm refreshes it). */
  loadAvatarHistory: () => Promise<AvatarHistoryItem[]>;
}

export interface UseProfileEditingResult {
  // Edit-mode form state
  isEditing: boolean;
  bio: string;
  bioJson: unknown;
  bioEditorResetKey: number;
  isAnonymous: boolean;
  newUsername: string;
  newDisplayName: string;
  confirmUsername: string;
  setNewDisplayName: (value: string) => void;
  setNewUsername: (value: string) => void;
  setConfirmUsername: (value: string) => void;
  /** GomoRichEditor onChange — keeps bio (legacy text) and bio_json in sync. */
  onBioChange: (json: unknown, text: string) => void;
  // Avatar / background / dialog state
  cropImage: string | null;
  avatarUploading: boolean;
  /** Avatar upload progress, 0..100 (drives the ring loader). */
  avatarUploadPercent: number;
  backgroundUploading: boolean;
  showUsernameDialog: boolean;
  isAvatarDragging: boolean;
  avatarDragHandlers: AvatarDragHandlers;
  // Actions
  startEditing: () => void;
  handleSaveAndExit: () => Promise<void>;
  handleUsernameChange: () => Promise<void>;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCropConfirm: (croppedImage?: Blob) => Promise<void>;
  handleBackgroundUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBackgroundRemove: () => Promise<void>;
  handleThemeEnabledToggle: (enabled: boolean) => Promise<void>;
  handleNicknameEmojiSelect: (sel: { emojiId: string }) => Promise<void>;
  handleNicknameEmojiRemove: () => Promise<void>;
  setShowUsernameDialog: (open: boolean) => void;
  closeUsernameDialog: () => void;
  setCropImage: (image: string | null) => void;
}

/**
 * Own-profile editing: edit-mode form state, avatar/background/theme uploads,
 * nickname emoji and the username-change dialog. All handlers are no-ops for a
 * foreign profile (guarded on currentUser.id === userId).
 */
export function useProfileEditing({
  userId,
  profile,
  currentUser,
  onProfileUpdate,
  onAvatarUrlChange,
  onNicknameEmojiChange,
  onReload,
  loadAvatarHistory,
}: UseProfileEditingParams): UseProfileEditingResult {
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [bioJson, setBioJson] = useState<unknown>(null);
  const [bioEditorResetKey, setBioEditorResetKey] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadPercent, setAvatarUploadPercent] = useState(0);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const avatarRingTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (avatarRingTimer.current != null) window.clearTimeout(avatarRingTimer.current);
  }, []);

  // Show the freshly picked avatar everywhere at once; the previous in-memory
  // preview (if any) is revoked so blobs do not pile up over the session.
  const showLocalAvatar = useCallback((ownerId: string, url: string, isAnimated: boolean) => {
    const store = useAvatarOverrideStore.getState();
    const previousUrl = store.overrides[ownerId]?.url;
    if (previousUrl && isLocalAvatarUrl(previousUrl) && previousUrl !== url) {
      URL.revokeObjectURL(previousUrl);
    }
    store.setAvatarOverride(ownerId, { url, animated: isAnimated });
  }, []);

  const clearLocalAvatar = useCallback((ownerId: string) => {
    const store = useAvatarOverrideStore.getState();
    const previousUrl = store.overrides[ownerId]?.url;
    if (previousUrl && isLocalAvatarUrl(previousUrl)) URL.revokeObjectURL(previousUrl);
    store.clearAvatarOverride(ownerId);
  }, []);

  // Hand the loader a completed ring for a beat, then take it down.
  const finishAvatarUpload = useCallback(() => {
    setAvatarUploadPercent(100);
    if (avatarRingTimer.current != null) window.clearTimeout(avatarRingTimer.current);
    avatarRingTimer.current = window.setTimeout(() => setAvatarUploading(false), AVATAR_RING_DONE_MS);
  }, []);

  const startEditing = useCallback(() => {
    if (!profile) return;
    setNewDisplayName(profile.display_name || profile.username);
    setNewUsername(profile.username);
    setBio(profile.bio || "");
    setBioJson(profile.bio_json ?? null);
    setBioEditorResetKey((prev) => prev + 1);
    setIsAnonymous(profile.is_anonymous);
    setIsEditing(true);
  }, [profile]);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const readAvatarFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCropImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Upload a video avatar: pick trim/crop/poster in the avatar editor, then
  // store the silent mp4 and flag the profile as animated.
  const handleAvatarVideoUpload = useCallback(async (file: File) => {
    if (!userId) return;
    const edit = await openVideoEditor(file, { mode: "avatar" });
    if (!edit) return; // cancelled → leave the current avatar alone

    setAvatarUploading(true);
    setAvatarUploadPercent(0);
    // Preview the picked clip right away (best effort — the server still
    // transcodes the final trim/crop). AnimatedVideo plays it muted in a loop.
    const previewUrl = URL.createObjectURL(file);
    showLocalAvatar(userId, previewUrl, true);
    try {
      const fileName = `${userId}/avatar_${Date.now()}.mp4`;
      const uploaded = await uploadFile(
        "post-images",
        fileName,
        file,
        undefined,
        false,
        (percent) => setAvatarUploadPercent(Math.min(99, percent)),
        () => setAvatarUploadPercent(99),
        { video_edit: JSON.stringify(edit) },
      );

      const token = (await api.auth.getSession()).data.session?.access_token;
      const updateRes = await fetch(`/api/v1/profiles/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: uploaded.path, avatar_animated: true }),
      });
      if (!updateRes.ok) {
        clearLocalAvatar(userId);
        setAvatarUploading(false);
        console.error("Update error:", await updateRes.text());
        toast.error(t("profile.updateError"));
        return;
      }

      // Point the override at the stored key so the blob can be released.
      showLocalAvatar(userId, uploaded.path, true);
      onAvatarUrlChange(uploaded.path);
      finishAvatarUpload();
      toast.success(t("profile.avatarUpdated"));
      dispatchProfileCacheInvalidate();
      await loadAvatarHistory();
    } catch (error) {
      clearLocalAvatar(userId);
      setAvatarUploading(false);
      toast.error(t("profile.imageProcessError"));
      console.error(error);
    }
  }, [userId, t, onAvatarUrlChange, loadAvatarHistory, showLocalAvatar, clearLocalAvatar, finishAvatarUpload]);

  const handleAvatarFile = useCallback((file: File) => {
    if (!file || !userId) return;
    if (file.type.startsWith("video/")) {
      void handleAvatarVideoUpload(file);
      return;
    }
    readAvatarFile(file);
  }, [userId, readAvatarFile, handleAvatarVideoUpload]);

  const handleAvatarUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleAvatarFile(file);
    // Allow re-selecting the same file.
    e.target.value = "";
  }, [handleAvatarFile]);

  // Drag & drop an image straight onto the avatar (edit mode only).
  const { isDragging: isAvatarDragging, dragHandlers: avatarDragHandlers } = useFileDrop(
    useCallback((files: File[]) => {
      const file = files[0];
      if (file && !!currentUser?.id && currentUser.id === userId && isEditing) {
        handleAvatarFile(file);
      }
    }, [currentUser, userId, isEditing, handleAvatarFile]),
  );

  const handleCropConfirm = useCallback(async (croppedImage?: Blob) => {
    if (!userId) return;

    // Show loader immediately and close crop dialog
    setCropImage(null);
    setAvatarUploading(true);
    setAvatarUploadPercent(0);

    try {
      if (!croppedImage) {
        setAvatarUploading(false);
        return;
      }

      // AvatarCropper returns a Blob directly. Do not fetch a data: URL:
      // CSP correctly blocks data: in connect-src, and no network request
      // is needed for an image already in memory.
      const blob = croppedImage;

      // The cropped blob is exactly the final avatar — show it everywhere now.
      const previewUrl = URL.createObjectURL(blob);
      showLocalAvatar(userId, previewUrl, false);

      const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' });
      const fileName = `${userId}/avatar_${Date.now()}.png`;

      const uploaded = await uploadFile(
        'post-images',
        fileName,
        croppedFile,
        undefined,
        true,
        (percent) => setAvatarUploadPercent(Math.min(99, percent)),
        () => setAvatarUploadPercent(99),
      );

      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const updateRes = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ avatar_url: uploaded.path, avatar_animated: false }),
      });

      if (!updateRes.ok) {
        clearLocalAvatar(userId);
        setAvatarUploading(false);
        console.error('Update error:', await updateRes.text());
        toast.error(t("profile.updateError"));
        return;
      }

      // Point the override at the stored key so the blob can be released.
      showLocalAvatar(userId, uploaded.path, false);
      onAvatarUrlChange(uploaded.path);
      finishAvatarUpload();
      toast.success(t("profile.avatarUpdated"));
      // Header/profile caches hold the old avatar_url — reset them now.
      dispatchProfileCacheInvalidate();

      // Reload avatar history
      await loadAvatarHistory();
    } catch (error) {
      clearLocalAvatar(userId);
      setAvatarUploading(false);
      toast.error(t("profile.imageProcessError"));
      console.error(error);
    }
  }, [userId, t, onAvatarUrlChange, loadAvatarHistory, showLocalAvatar, clearLocalAvatar, finishAvatarUpload]);

  // ── Background + auto-theme ────────────────────────────────────────────────
  const handleBackgroundUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId || !currentUser || currentUser.id !== userId) return;
    setBackgroundUploading(true);
    try {
      const fileName = `${userId}/background_${Date.now()}.png`;
      const uploaded = await uploadFile("post-images", fileName, file);

      // Auto-theme: regenerate the theme tokens from the new background so
      // the owner's theme always matches their latest image. The dominant
      // variant is picked by default (the studio will let the owner choose
      // among the 5 generated palettes later). Kept as a best effort — a
      // failed extraction simply leaves the previous tokens.
      let themeTokens: Record<string, string> | null = null;
      try {
        const { generateThemeVariants } = await import("@/utils/profileTheme");
        const variants = await generateThemeVariants(file);
        themeTokens = variants.find((v) => v.id === "dominant")?.tokens ?? variants[0]?.tokens ?? null;
      } catch {
        // ignore — theme stays as-is when the image cannot be decoded
      }

      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: uploaded.path,
        ...(themeTokens ? { theme_tokens: themeTokens } : {}),
      });
      if (error) throw error;

      onProfileUpdate((prev) => (prev ? { ...prev, background_url: uploaded.path, theme_tokens: themeTokens ?? prev.theme_tokens } : prev));
      // Profile caches (hover cards, header, own page) hold the old value.
      dispatchProfileCacheInvalidate();
      toast.success(t("profile.bgUpdated"));
    } catch (error) {
      toast.error(t("profile.bgLoadError"));
      console.error(error);
    } finally {
      setBackgroundUploading(false);
      e.target.value = "";
    }
  }, [userId, currentUser, t, onProfileUpdate]);

  // Toggle whether viewers see the owner's auto-theme on the profile page.
  const handleThemeEnabledToggle = useCallback(async (enabled: boolean) => {
    if (!userId || !currentUser || currentUser.id !== userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        theme_enabled: enabled,
      });
      if (error) throw error;
      onProfileUpdate((prev) => (prev ? { ...prev, theme_enabled: enabled } : prev));
      dispatchProfileCacheInvalidate();
      toast.success(enabled ? t("profile.themeEnabled") : t("profile.themeDisabled"));
    } catch (error) {
      toast.error(t("profile.themeSaveError"));
      console.error(error);
    }
  }, [userId, currentUser, t, onProfileUpdate]);

  const handleBackgroundRemove = useCallback(async () => {
    if (!userId || !currentUser || currentUser.id !== userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: null,
      });
      if (error) throw error;

      onProfileUpdate((prev) => (prev ? { ...prev, background_url: null } : prev));
      dispatchProfileCacheInvalidate();
      toast.success(t("profile.bgRemoved"));
    } catch (error) {
      toast.error(t("profile.bgRemoveError"));
      console.error(error);
    }
  }, [userId, currentUser, t, onProfileUpdate]);

  // ── Nickname emoji (custom emoji shown right of the display name) ──────────
  const saveNicknameEmoji = useCallback(async (emojiId: string) => {
    if (!currentUser || currentUser.id !== userId) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ nickname_emoji_id: emojiId }),
      });
      if (!res.ok) throw new Error('Failed to save nickname emoji');

      onNicknameEmojiChange(emojiId);
      // The emoji is stored on the user, not in profile_customization — but the
      // profile object is cached everywhere, so refresh local caches too
      // (dispatchProfileCacheInvalidate clears the customization cache AND
      // notifies ProfileCacheContext + currentUserMeta).
      dispatchProfileCacheInvalidate();
      toast.success(emojiId ? t("profile.emojiSaved") : t("profile.emojiRemoved"));
    } catch (error) {
      toast.error(emojiId ? t("profile.emojiSaveError") : t("profile.emojiRemoveError"));
      console.error(error);
    }
  }, [userId, currentUser, t, onNicknameEmojiChange]);

  const handleNicknameEmojiSelect = useCallback(
    (sel: { emojiId: string }) => saveNicknameEmoji(sel.emojiId),
    [saveNicknameEmoji],
  );

  const handleNicknameEmojiRemove = useCallback(
    () => saveNicknameEmoji(""),
    [saveNicknameEmoji],
  );

  // ── Save flows ─────────────────────────────────────────────────────────────
  const handleSaveAndExit = useCallback(async () => {
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const prevBioJson = profile?.bio_json ?? null;
      const bioJsonChanged =
        JSON.stringify(bioJson ?? null) !== JSON.stringify(prevBioJson);
      if (userId && profile && (bio !== profile.bio || bioJsonChanged)) {
        const bioRes = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ bio, bio_json: bioJson }),
        });
        if (!bioRes.ok) throw new Error('Failed to save bio');
      }

      // Save display_name changes
      if (userId && profile && newDisplayName.trim() && newDisplayName !== (profile.display_name || profile.username)) {
        const displayNameRes = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ display_name: newDisplayName.trim() }),
        });
        if (!displayNameRes.ok) throw new Error('Failed to save display name');

        onProfileUpdate(prev => prev ? { ...prev, display_name: newDisplayName.trim() } : null);
      }

      // Save anonymity setting
      if (userId && profile && isAnonymous !== profile.is_anonymous) {
        const anonRes = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ is_anonymous: isAnonymous }),
        });
        if (!anonRes.ok) throw new Error('Failed to save anonymity');
      }

      setIsEditing(false);
      setNewDisplayName("");
      setNewUsername("");

      // Bio/display_name/anonymity changed — reset all profile caches.
      dispatchProfileCacheInvalidate();

      // Reload profile to show updated bio with processed tags
      await onReload();

      toast.success(t("profile.changesSaved"));
    } catch (error) {
      toast.error(t("profile.changesSaveError"));
      console.error(error);
    }
  }, [userId, profile, bio, bioJson, newDisplayName, isAnonymous, t, onProfileUpdate, onReload]);

  const handleUsernameChange = useCallback(async () => {
    if (!newUsername.trim()) {
      toast.error(t("profile.enterUsername"));
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(newUsername)) {
      toast.error(t("error.username_chars"));
      return;
    }
    if (newUsername.length < 3 || newUsername.length > 20) {
      toast.error(t("error.username_length"));
      return;
    }
    if (newUsername !== confirmUsername) {
      toast.error(t("profile.usernamesMismatch"));
      return;
    }
    if (newUsername === profile?.username) {
      toast.error(t("profile.usernameUnchanged"));
      return;
    }

    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ username: newUsername }),
      });

      const result = await res.json();
      if (!res.ok) {
        toast.error(
          apiErrorMessage(
            { code: result.code, params: result.params, message: result.error },
            t,
            "error.generic"
          )
        );
        return;
      }

      toast.success(t("profile.usernameChanged"));
      onProfileUpdate(prev => prev ? { ...prev, username: newUsername } : null);
      // Header/currentUserMeta caches keyed by the OLD username must reset.
      dispatchProfileCacheInvalidate();
      setShowUsernameDialog(false);
      setNewUsername("");
      setConfirmUsername("");
    } catch (error) {
      toast.error(t("profile.usernameChangeError"));
      console.error(error);
    }
  }, [newUsername, confirmUsername, profile, userId, t, onProfileUpdate]);

  const closeUsernameDialog = useCallback(() => {
    setShowUsernameDialog(false);
    setNewUsername("");
    setConfirmUsername("");
  }, []);

  const onBioChange = useCallback((json: unknown, text: string) => {
    setBioJson(json);
    setBio(text);
  }, []);

  return {
    isEditing,
    bio,
    bioJson,
    bioEditorResetKey,
    isAnonymous,
    newUsername,
    newDisplayName,
    confirmUsername,
    cropImage,
    avatarUploading,
    avatarUploadPercent,
    backgroundUploading,
    showUsernameDialog,
    isAvatarDragging,
    avatarDragHandlers,
    startEditing,
    handleSaveAndExit,
    handleUsernameChange,
    handleAvatarUpload,
    handleCropConfirm,
    handleBackgroundUpload,
    handleBackgroundRemove,
    handleThemeEnabledToggle,
    handleNicknameEmojiSelect,
    handleNicknameEmojiRemove,
    setNewDisplayName,
    setNewUsername,
    setConfirmUsername,
    onBioChange,
    setShowUsernameDialog,
    closeUsernameDialog,
    setCropImage,
  };
}