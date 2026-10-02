import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Edit2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FriendButton } from "@/components/FriendButton";
import { PostActionsMenu } from "@/components/PostActionsMenu";
import { UserAvatar } from "@/components/UserAvatar";
import type { Profile } from "./types";

// The social-graph block is only needed once the panel is open — keep it in its
// own chunk so the regular social profile never pays for it.
const SubscriptionsPanel = lazy(() =>
  import("@/components/SubscriptionsPanel").then((m) => ({ default: m.SubscriptionsPanel }))
);

export interface ForumProfilePanelProps {
  profile: Profile;
  isOwnProfile: boolean;
  /** canViewSection(privateHideAvatar) — computed by the page. */
  avatarVisible: boolean;
  avatarUrl: string | null;
  currentUser: { id: string } | null;
  /** canViewSection(privateHideFriends) — computed by the page. */
  canViewSubscriptions: boolean;
  onAvatarClick: () => void;
  onOpenMessages: () => void;
  /** isEditing ? save-and-exit : start editing (own profile). */
  onEditClick: () => void;
}

/**
 * Compact side column of the forum layout — a stack of independent cards rather
 * than one solid block: an identity card (square cover + write/subscribe
 * actions) and a social-graph card (subscribers / subscriptions). Everything
 * else stays in the content column and reflows around it.
 */
export function ForumProfilePanel({
  profile,
  isOwnProfile,
  avatarVisible,
  avatarUrl,
  currentUser,
  canViewSubscriptions,
  onAvatarClick,
  onOpenMessages,
  onEditClick,
}: ForumProfilePanelProps) {
  const { t } = useTranslation();
  const displayName = profile.display_name?.trim() || profile.username;
  const showActions = !isOwnProfile && !!currentUser;

  return (
    <div className="space-y-2.5" data-testid="forum-profile-panel">
      {/* Identity card — square cover with the actions pinned underneath. */}
      <section className="surface-panel overflow-hidden rounded-xl border border-border/60 shadow-sm">
        {avatarVisible && (
          <button
            type="button"
            onClick={onAvatarClick}
            aria-label={displayName}
            className="group/avatar relative block w-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <UserAvatar
              src={avatarUrl}
              userId={profile.id}
              alt={displayName}
              square
              className="aspect-square w-full text-3xl transition-transform duration-300 group-hover/avatar:scale-[1.03]"
            />
          </button>
        )}

        {(showActions || isOwnProfile) && (
          <div className="space-y-1.5 p-2.5">
            {isOwnProfile ? (
              <Button
                variant="default"
                onClick={onEditClick}
                className="h-9 w-full gap-1.5 rounded-lg text-xs font-medium"
              >
                <Edit2 className="h-3.5 w-3.5" />
                {t("common.edit")}
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={onOpenMessages}
                title={t("profile.write")}
                className="h-9 w-full gap-1.5 rounded-lg text-xs font-medium"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t("profile.write")}
              </Button>
            )}

            {showActions && (
              <div className="flex items-stretch gap-1.5">
                <FriendButton
                  userId={profile.id}
                  isOwnProfile={isOwnProfile}
                  withLabel
                  className="h-9 flex-1 rounded-lg text-xs"
                />
                <PostActionsMenu
                  targetType="user"
                  targetId={profile.id}
                  reportLabel="Пожаловаться на пользователя"
                  reportTargetLabel="на пользователя"
                  triggerTitle="Действия"
                  triggerClassName="h-9 w-9 rounded-lg border border-border/60 bg-background/60"
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Social-graph card — separate panel, its own header (the in-panel
          «Подписчики / Подписки» toggle) and a scrollable list. */}
      {canViewSubscriptions && (
        <section className="surface-panel rounded-xl border border-border/60 p-2.5 shadow-sm">
          <div className="max-h-[22rem] overflow-y-auto">
            <Suspense fallback={null}>
              <SubscriptionsPanel userId={profile.id} limit={5} />
            </Suspense>
          </div>
        </section>
      )}
    </div>
  );
}
