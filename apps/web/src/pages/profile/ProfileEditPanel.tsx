import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Profile } from "./types";

// Heavy interaction-only components — split into separate chunks so the
// profile page's initial JS is small on mobile. Loaded on first use (edit
// mode) instead of on every visit.
const GomoRichEditor = lazy(() => import("@/components/GomoRichEditor").then((m) => ({ default: m.GomoRichEditor })));
const AvatarCropper = lazy(() => import("@/components/AvatarCropper").then((m) => ({ default: m.AvatarCropper })));

export interface ProfileEditPanelProps {
  isOwnProfile: boolean;
  profile: Profile | null;
  bio: string;
  bioJson: unknown;
  bioEditorResetKey: number;
  cropImage: string | null;
  onBioChange: (json: unknown, text: string) => void;
  onCropCancel: () => void;
  onCropComplete: (croppedImage?: Blob) => void;
  onThemeToggle: (enabled: boolean) => void;
}

/** Edit-mode section: auto-theme toggle, bio editor and the avatar crop
 * dialog. Rendered by the page in place of the viewer content. */
export function ProfileEditPanel({
  isOwnProfile,
  profile,
  bio,
  bioJson,
  bioEditorResetKey,
  cropImage,
  onBioChange,
  onCropCancel,
  onCropComplete,
  onThemeToggle,
}: ProfileEditPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      {/* Auto-theme toggle: when on, viewers see this profile in the
          owner's theme (generated from the background/avatar). */}
      {isOwnProfile && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
          <div>
            <Label htmlFor="profile-theme-toggle" className="text-sm font-semibold">
              Тема профиля
            </Label>
            <p className="text-xs text-muted-foreground">
              Показывать посетителям тему, сгенерированную из фона и аватара
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="profile-theme-toggle"
              checked={!!profile?.theme_enabled}
              onCheckedChange={onThemeToggle}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => navigate("/settings/prof-studio")}
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t("profile.studio")}</span>
              <span className="sm:hidden">{t("profile.studio")}</span>
            </Button>
          </div>
        </div>
      )}
      <div>
        <Label>{t("profile.about")}</Label>
        <Suspense fallback={<div className="h-[120px] animate-pulse rounded-lg bg-muted" />}>
          <GomoRichEditor
            resetKey={bioEditorResetKey}
            contentJson={bioJson}
            legacyContent={bio}
            onChange={({ json, text }) => {
              onBioChange(json, text);
            }}
            placeholder={t("profile.aboutPlaceholder")}
            minHeightClassName="min-h-[120px]"
          />
        </Suspense>
      </div>

      {/* Avatar Crop Dialog */}
      <Dialog open={!!cropImage} onOpenChange={onCropCancel}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("profile.avatarCrop")}</DialogTitle>
          </DialogHeader>
          {cropImage && (
            <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
              <AvatarCropper
                imageSrc={cropImage}
                onCropComplete={onCropComplete}
                onCancel={onCropCancel}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}