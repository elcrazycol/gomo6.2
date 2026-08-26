import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { storageUrl } from "@/utils/storage";
import type { AvatarHistoryItem } from "./types";

// Heavy interaction-only component — split into a separate chunk so the
// profile page's initial JS is small on mobile. Loaded on first open instead
// of on every visit.
const AvatarGallery = lazy(() => import("@/components/AvatarGallery").then((m) => ({ default: m.AvatarGallery })));

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

/** Full-screen avatar history gallery (lazy AvatarGallery chunk). */
export function AvatarGalleryDialog({
  avatars,
  initialIndex,
  canDelete,
  onClose,
  onDelete,
}: AvatarGalleryDialogProps) {
  if (avatars.length === 0) return null;

  return (
    <Suspense fallback={null}>
      <AvatarGallery
        avatars={avatars.map((ah) => ({
          id: ah.id,
          url: storageUrl("post-images", ah.avatar_url) || ah.avatar_url,
          is_current: ah.is_current,
        }))}
        initialIndex={initialIndex}
        onClose={onClose}
        onDelete={canDelete ? onDelete : undefined}
        canDelete={canDelete}
      />
    </Suspense>
  );
}