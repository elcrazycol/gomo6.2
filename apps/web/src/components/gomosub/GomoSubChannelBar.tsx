import { memo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BookOpenText, ChevronDown, Hash, Lock, MessageSquare, Plus, Settings, Share2, UserCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EASE_OUT_EXPO, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface GomoSubChannelBarProps {
  /** Key that changes per channel — drives the directional name slide. */
  channelKey: string;
  /** +1 / -1 travel direction between channels. */
  direction: 1 | -1;
  channelName: string;
  channelTopic?: string | null;
  isPrivate: boolean;
  kind?: "forum" | "text";
  boardSlug: string;
  /** Mobile: opens the channel sheet. */
  onOpenChannels: () => void;
  channelsTitle: string;
  generalLabel: string;
  /** Member rail toggle (desktop + mobile). Null hides the button. */
  membersCount?: number | null;
  membersActive?: boolean;
  onToggleMembers?: () => void;
  onShare: () => void;
  shareTitle: string;
  /** Compact join / member button. Null hides it (e.g. guests handled outside). */
  joinVisible: boolean;
  isJoined: boolean;
  joinDisabled?: boolean;
  onToggleJoin: () => void;
  joinLabel: string;
  memberLabel: string;
  /** Forum channels: primary "Создать запись" action. */
  canCreate: boolean;
  onCreate: () => void;
  createLabel: string;
  /** Moderation shortcuts. */
  hasRules: boolean;
  onOpenRules?: () => void;
  canManage: boolean;
  onOpenSettings?: () => void;
}

/**
 * Discord-style channel bar shared by forum and text channels: mobile
 * channel pill, `# name + topic` on desktop, member toggle, share, join and
 * the contextual primary action. The channel identity slides directionally
 * on switch (spring geometry, expo fade) instead of blinking.
 */
export const GomoSubChannelBar = memo(
  ({
    channelKey,
    direction,
    channelName,
    channelTopic,
    isPrivate,
    kind,
    boardSlug,
    onOpenChannels,
    channelsTitle,
    generalLabel,
    membersCount,
    membersActive,
    onToggleMembers,
    onShare,
    shareTitle,
    joinVisible,
    isJoined,
    joinDisabled,
    onToggleJoin,
    joinLabel,
    memberLabel,
    canCreate,
    onCreate,
    createLabel,
    hasRules,
    onOpenRules,
    canManage,
    onOpenSettings,
  }: GomoSubChannelBarProps) => {
    const reduce = useReducedMotion();
    const Glyph = kind === "text" ? MessageSquare : Hash;

    return (
      <div className="sticky top-2 z-20 flex items-center gap-2 h-12 px-3 rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm mb-3">
        {/* Mobile channel switcher — opens the bottom sheet */}
        <button
          onClick={onOpenChannels}
          className="md:hidden flex items-center gap-1.5 flex-1 min-w-0 h-8 px-2 rounded-lg border border-border/50 bg-surface text-sm text-foreground hover:bg-muted/60 active:scale-[0.98] transition"
          title={channelsTitle}
        >
          {isPrivate ? (
            <Lock className="w-3.5 h-3.5 shrink-0 text-amber-500" />
          ) : (
            <Glyph className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{channelName || generalLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground ml-auto" />
        </button>
        {/* Desktop: Discord-style channel identity with directional slide */}
        <motion.div
          key={channelKey}
          initial={reduce ? false : { opacity: 0, x: direction * 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { ...SPRING.standard, opacity: { duration: 0.16, ease: EASE_OUT_EXPO } }
          }
          className="hidden md:flex items-center gap-2 min-w-0 flex-1"
        >
          <Glyph className="w-5 h-5 shrink-0 text-muted-foreground/70" />
          <h1 className="text-[15px] font-bold truncate">{channelName || generalLabel}</h1>
          {isPrivate && <Lock className="w-3.5 h-3.5 shrink-0 text-amber-500" />}
          {channelTopic && (
            <>
              <div className="w-px h-5 bg-border/70 mx-1 shrink-0" />
              <span className="text-[13px] text-muted-foreground truncate">{channelTopic}</span>
            </>
          )}
        </motion.div>
        {/* Compact actions */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {canCreate && (
            <Button
              onClick={onCreate}
              size="sm"
              className="h-8 px-2.5 text-xs rounded-lg"
              title={createLabel}
            >
              <Plus className="w-3.5 h-3.5 sm:mr-1" />
              <span className="hidden sm:inline">{createLabel}</span>
            </Button>
          )}
          {membersCount != null && onToggleMembers && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", membersActive && "bg-primary/10 text-primary")}
              onClick={onToggleMembers}
              title={`Участники · ${membersCount}`}
            >
              <Users className="w-4 h-4" />
            </Button>
          )}
          {hasRules && onOpenRules && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onOpenRules}
              title="Правила"
            >
              <BookOpenText className="w-4 h-4" />
            </Button>
          )}
          {canManage && onOpenSettings && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onOpenSettings}
              title="Настройки"
            >
              <Settings className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onShare}
            title={shareTitle}
          >
            <Share2 className="w-4 h-4" />
          </Button>
          {joinVisible && (
            <Button
              variant={isJoined ? "secondary" : "default"}
              onClick={onToggleJoin}
              className={`h-8 px-3 text-xs ${isJoined ? "bg-primary/12 text-primary hover:bg-primary/20 border border-primary/35" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              disabled={joinDisabled}
            >
              {isJoined ? (
                <>
                  <UserCheck className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">{memberLabel}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">{joinLabel}</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  },
);

GomoSubChannelBar.displayName = "GomoSubChannelBar";
