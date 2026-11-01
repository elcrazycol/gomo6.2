import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BookOpenText, Lock, Share2, UserCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PostActionsMenu } from "@/components/PostActionsMenu";
import { storageUrl } from "@/utils/storage";
import { formatCompactCount } from "@/utils/formatCount";
import { springFor } from "@/lib/motion";
import { useStoriesStore } from "@/stores/storiesStore";
import { hasUnreadCloseFriends, isStoryLive, type Story } from "@/types/stories";
import { StorySquareRing } from "@/components/stories/StorySquareRing";

interface BoardLike {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility?: string | null;
  cover_image_url?: string | null;
  gomosub_avatar_url?: string | null;
  gomosub_tags?: string[] | null;
  owner_id?: string | null;
  rules_markdown?: string | null;
}

interface GomoSubHeaderProps {
  board: BoardLike;
  /** Tags parsed from the board row (array already sanitized). */
  tags: string[];
  /** Viewer id (null for guests). */
  viewerId?: string | null;
  isJoined: boolean;
  /**
   * Membership not resolved yet (fetch in flight). The join slot renders a
   * ghost with the same footprint instead of a wrong "Вступить" that flips
   * to "Вы участник" a frame later.
   */
  membershipPending: boolean;
  memberCount: number | null;
  membershipLoading: boolean;
  checkingRules: boolean;
  onToggleJoin: () => void;
  /** Live board stories for the avatar ring (square outline). */
  stories: Story[];
  /** Board id + name for the story viewer/composer. */
  boardId: string;
  /** Owner or a can_post_stories role: empty ring opens the composer. */
  canPostStories: boolean;
  /** Opens the rules dialog (rules icon left of share). */
  onOpenRules?: () => void;
  /** i18n labels from the caller (Board). */
  joinLabel?: string;
  joinedLabel?: string;
  shareTitle?: string;
}

/**
 * Compact community header: cover as a backdrop, avatar straddling the fold,
 * one row of name / slug / stats and the actions. Deliberately NOT a
 * half-screen hero — the workspace content starts right below.
 */
export const GomoSubHeader = memo(
  ({
    board,
    tags,
    viewerId,
    isJoined,
    membershipPending,
    memberCount,
    membershipLoading,
    checkingRules,
    onToggleJoin,
    joinLabel = "Вступить",
    joinedLabel = "Вы участник",
    shareTitle = "Поделиться ссылкой",
    stories,
    boardId,
    canPostStories,
    onOpenRules,
  }: GomoSubHeaderProps) => {
    const cover = board.cover_image_url ? storageUrl("post-images", board.cover_image_url) : null;
    const avatar = board.gomosub_avatar_url ? storageUrl("post-images", board.gomosub_avatar_url) : null;
    const letter = board.name?.[0] || board.slug[0] || "g";
    const prefersReducedMotion = useReducedMotion();
    const openViewer = useStoriesStore((s) => s.openViewer);
    const openComposer = useStoriesStore((s) => s.openComposer);

    // Avatar story ring (square): live slides open the viewer at the first
    // unread, an empty ring with the post permission opens the composer.
    const live = useMemo(() => stories.filter((story) => isStoryLive(story)), [stories]);
    const readCount = live.filter((story) => story.is_viewed).length;
    const closeFriends = hasUnreadCloseFriends(live);
    const firstUnread = live.find((story) => !story.is_viewed) ?? live[0];
    const interactive = live.length > 0 || canPostStories;

    const openStories = () => {
      if (live.length > 0 && firstUnread) {
        openViewer({ ownerType: "gosub", ownerId: boardId, ownerName: board.name, storyId: firstUnread.id, origin: "board" });
      } else if (canPostStories) {
        openComposer({ ownerType: "gosub", ownerId: boardId, ownerName: board.name });
      }
    };

    const share = () => {
      const url = `${window.location.origin}/g/${board.slug}`;
      navigator.clipboard.writeText(url).then(
        () => toast.success("Ссылка на саб скопирована"),
        () => toast.error("Не удалось скопировать ссылку"),
      );
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springFor("soft", prefersReducedMotion)}
      >
      <Card className="overflow-hidden rounded-2xl border-border/70 bg-surface">
        <div className="relative">
          <div className="h-24 sm:h-32">
            {cover ? (
              <img
                src={cover || undefined}
                alt={`Обложка g/${board.slug}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="relative h-full w-full bg-gradient-to-br from-primary/20 via-primary/10 to-muted">
                <span
                  aria-hidden
                  className="absolute -bottom-4 right-3 select-none text-7xl font-black uppercase leading-none tracking-tight text-primary/20"
                >
                  {letter.toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="relative -mt-8 sm:-mt-10 px-4 sm:px-5 pb-4 sm:pb-5">
            <div className="flex items-end justify-between gap-3">
              <StorySquareRing total={live.length} read={readCount} closeFriends={closeFriends}>
                {interactive ? (
                  <button
                    type="button"
                    onClick={openStories}
                    aria-label={live.length > 0 ? `Смотреть истории ${board.name}` : "Добавить историю"}
                    title={live.length > 0 ? `Смотреть истории ${board.name}` : "Добавить историю"}
                    className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 overflow-hidden rounded-2xl border-[3px] border-background bg-muted shadow-md transition-transform duration-150 hover:scale-[1.03] active:scale-95"
                  >
                    {avatar ? (
                      <img src={avatar || undefined} alt={board.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-muted text-xl sm:text-2xl font-bold text-primary">
                        {letter.toUpperCase()}
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 overflow-hidden rounded-2xl border-[3px] border-background bg-muted shadow-md">
                    {avatar ? (
                      <img src={avatar || undefined} alt={board.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-muted text-xl sm:text-2xl font-bold text-primary">
                        {letter.toUpperCase()}
                      </div>
                    )}
                  </div>
                )}
              </StorySquareRing>
              <div className="flex items-center gap-1.5 pb-0.5">
                {board.rules_markdown?.trim() && onOpenRules && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={onOpenRules}
                    title="Правила"
                    disabled={checkingRules}
                  >
                    <BookOpenText className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={share}
                  title={shareTitle}
                >
                  <Share2 className="w-4 h-4" />
                </Button>
                {/* The button is REAL from the first paint — no invisible ghost,
                    no fade-in of the join slot. While membership is in flight
                    it wears the joined look and disables itself; the trailing
                    swap to «Вступить» (for non-members) is just text, and the
                    whole card settles with its soft page-load spring. */}
                <Button
                  variant={isJoined || membershipPending ? "secondary" : "default"}
                  onClick={onToggleJoin}
                  className={`h-9 px-4 text-sm ${
                    isJoined || membershipPending
                      ? "border border-primary/35 bg-primary/12 text-primary hover:bg-primary/20"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                  disabled={membershipPending || membershipLoading || checkingRules}
                  aria-busy={membershipPending}
                >
                  {(membershipPending || isJoined) ? (
                    <>
                      <UserCheck className="w-4 h-4 mr-2" />
                      {joinedLabel}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-2" />
                      {joinLabel}
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">{board.name}</h1>
              <span className="text-sm font-semibold text-primary">g/{board.slug}</span>
              {/* Reserved slot: an invisible placeholder keeps the row from
                  jumping when the count arrives from the directory cache. */}
              <span
                className="flex items-center gap-1 text-xs text-muted-foreground min-w-[3.5rem]"
                data-testid="gomosub-member-count"
              >
                {memberCount != null && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex items-center gap-1"
                  >
                    <Users className="h-3 w-3" />
                    {formatCompactCount(memberCount)}
                  </motion.span>
                )}
              </span>
              {board.visibility === "private" && <Lock className="h-3.5 w-3.5 text-amber-500" />}
              {viewerId && board.owner_id !== viewerId && (
                <PostActionsMenu
                  targetType="gomosub"
                  targetId={board.id}
                  reportLabel="Пожаловаться на саб"
                  reportTargetLabel="на саб"
                  triggerTitle="Действия"
                  triggerClassName="h-6 w-6 rounded-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 [&_svg]:h-3.5 [&_svg]:w-3.5"
                />
              )}
            </div>

            {board.description && (
              <p className="mt-1 max-w-[720px] text-sm text-muted-foreground">{board.description}</p>
            )}

            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.slice(0, 6).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
      </motion.div>
    );
  },
);

GomoSubHeader.displayName = "GomoSubHeader";
