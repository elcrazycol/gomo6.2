import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import type { AvatarHistoryItem } from "./types";

export interface UsernameDialogProps {
  open: boolean;
  newUsername: string;
  confirmUsername: string;
  profileUsername: string | undefined;
  onOpenChange: (open: boolean) => void;
  onNewUsernameChange: (value: string) => void;
  onConfirmUsernameChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** Username change dialog — invariant checks mirror handleUsernameChange. */
export function UsernameDialog({
  open,
  newUsername,
  confirmUsername,
  profileUsername,
  onOpenChange,
  onNewUsernameChange,
  onConfirmUsernameChange,
  onCancel,
  onSave,
}: UsernameDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.changeUsername")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("profile.usernameDescription")}
        </p>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="new-username">{t("profile.newUsername")}</Label>
            <Input
              id="new-username"
              value={newUsername}
              onChange={(e) => onNewUsernameChange(e.target.value)}
              placeholder="newuser"
              maxLength={20}
            />
          </div>
          <div>
            <Label htmlFor="confirm-username">{t("profile.repeatUsername")}</Label>
            <Input
              id="confirm-username"
              value={confirmUsername}
              onChange={(e) => onConfirmUsernameChange(e.target.value)}
              placeholder="newuser"
              maxLength={20}
            />
          </div>
          {newUsername && !/^[a-zA-Z0-9]+$/.test(newUsername) && (
            <p className="text-xs text-destructive">{t("profile.latinOnly")}</p>
          )}
          {newUsername && newUsername === confirmUsername && newUsername !== profileUsername && (
            <p className="text-xs text-green-500">{t("profile.usernamesMatch")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onSave}
            disabled={!newUsername.trim() || newUsername !== confirmUsername || newUsername === profileUsername || !/^[a-zA-Z0-9]+$/.test(newUsername)}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface AvatarGalleryDialogProps {
  avatars: AvatarHistoryItem[];
  initialIndex: number;
  canDelete: boolean;
  onClose: () => void;
  onDelete: (avatarId: string) => Promise<void>;
}

/** Full-screen avatar history viewer — reuses the shared media Lightbox
 * (embla carousel, zoom/pan, thumbnails, keyboard) instead of a bespoke
 * gallery. Deletion stays owner-only and is confirmed on top of the viewer. */
export function AvatarGalleryDialog({
  avatars,
  initialIndex,
  canDelete,
  onClose,
  onDelete,
}: AvatarGalleryDialogProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  const [resetKey, setResetKey] = useState(0);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // The history can shrink from under us after a delete — keep the selection
  // inside the new bounds.
  useEffect(() => {
    setIndex((prev) => Math.min(prev, Math.max(0, avatars.length - 1)));
  }, [avatars.length]);

  const items = useMemo<LightboxItem[]>(
    () =>
      avatars.map((avatar, i) => ({
        id: avatar.id,
        url: avatar.avatar_url,
        type: "image",
        name: `avatar-${i + 1}.png`,
      })),
    [avatars],
  );

  if (avatars.length === 0) return null;

  const confirmAvatar = confirmIndex !== null ? avatars[confirmIndex] : null;

  const handleConfirmDelete = async () => {
    if (confirmIndex === null || !canDelete || !confirmAvatar) {
      setConfirmIndex(null);
      return;
    }
    // Deleting the last slide steps back to the new last one; otherwise the
    // selection stays put. The lightbox is remounted so its carousel starts on
    // the adjusted index (the parent reloads the history asynchronously).
    const nextIndex = confirmIndex >= avatars.length - 1 ? Math.max(0, avatars.length - 2) : confirmIndex;
    setIsDeleting(true);
    try {
      await onDelete(confirmAvatar.id);
      if (avatars.length === 1) {
        onClose();
      } else {
        setIndex(nextIndex);
        setResetKey((key) => key + 1);
      }
    } finally {
      setIsDeleting(false);
      setConfirmIndex(null);
    }
  };

  return (
    <>
      <Lightbox
        key={`avatar-gallery-${resetKey}`}
        items={items}
        initialIndex={index}
        bucket="post-images"
        onClose={onClose}
        onDeleteItem={canDelete ? (i) => setConfirmIndex(i) : undefined}
        deleteLabel={t("profile.avatarDeleteAction")}
      />

      <AlertDialog
        open={confirmIndex !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setConfirmIndex(null);
        }}
      >
        {/* Raised above the fullscreen lightbox (z-index 150 → content 200). */}
        <AlertDialogContent className="z-[200]" overlayClassName="z-[190]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.avatarDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAvatar?.is_current
                ? t("profile.avatarDeleteCurrent")
                : t("profile.avatarDeleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-500 hover:bg-red-600"
              disabled={isDeleting}
            >
              {isDeleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}