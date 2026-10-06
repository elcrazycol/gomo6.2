import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useFriendsStore, type FriendStatus } from "@/stores/friendsStore";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Check, Users, UserMinus } from "lucide-react";
import { toast } from "sonner";

interface FriendButtonProps {
  userId: string;
  isOwnProfile: boolean;
  /** Render a labelled, full-width button (forum panel) instead of the icon square. */
  withLabel?: boolean;
  className?: string;
}

// Rounded-square action button, shared with the message/dots buttons so the
// profile action cluster aligns. Pressing it gives a small scale response, and
// it carries no focus/selection ring.
const ACTION_BTN =
  "h-9 w-9 shrink-0 rounded-xl border border-border/60 bg-background/85 backdrop-blur-md transition-all duration-150 hover:bg-background active:scale-90 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0";

/** Icon transition: the outgoing glyph spins/fades out while the incoming one
 *  spins in. Runs only when the relationship actually changes (not on hover). */
const ICON_ANIM = {
  initial: { scale: 0.3, rotate: -90, opacity: 0 },
  animate: { scale: 1, rotate: 0, opacity: 1 },
  exit: { scale: 0.3, rotate: 90, opacity: 0 },
  transition: { type: "spring" as const, stiffness: 500, damping: 26 },
};

type Pulse = "follow" | "friend" | "unfollow";

/** Ring colour + strength per transition. */
const PULSE_RING: Record<Pulse, string> = {
  follow: "ring-primary/60",
  friend: "ring-primary/70",
  unfollow: "ring-destructive/40",
};

/**
 * Compact subscribe control: a «+» that spins into a check once following —
 * and into the friends glyph when the follow turns mutual. Every relationship
 * change (follow, becoming friends, unfollow) plays the same icon swap plus a
 * one-shot ring pulse, so the action always reads as confirmed. While following
 * the button opens a menu so unfollowing stays deliberate.
 */
export const FriendButton = ({ userId, isOwnProfile, withLabel = false, className }: FriendButtonProps) => {
  const { friendStatusMap, subscribe, unsubscribe, checkStatus } = useFriendsStore();
  const [loading, setLoading] = useState(false);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  // Menu is only actionable while following (subscribed or friends); kept
  // mounted for everyone so the button never remounts across status changes
  // (that would kill the icon transition — the friendship glyph used to snap in).
  const [menuOpen, setMenuOpen] = useState(false);
  // Records whether the relationship was already a follow when the trigger was
  // pressed, so a subscribe click that turns mutual never opens the menu.
  const menuAllowedRef = useRef(false);

  const statusData = friendStatusMap[userId];
  const status: FriendStatus = statusData?.status || "none";
  const followsYou = statusData?.followsYou;

  const prevStatusRef = useRef<FriendStatus | null>(null);
  // The first checkStatus only syncs the server value; it must not fire a pulse.
  const syncedRef = useRef(false);

  useEffect(() => {
    if (isOwnProfile || !userId) return;
    let cancelled = false;
    syncedRef.current = false;
    prevStatusRef.current = null;
    checkStatus(userId).then((s) => {
      if (cancelled) return;
      prevStatusRef.current = s;
      syncedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isOwnProfile, checkStatus]);

  // Pulse on every real transition (follow, become friends, unfollow), no matter
  // what triggered it — the subscribe button or a server-side mutual follow.
  useEffect(() => {
    if (!syncedRef.current) return;
    const prev = prevStatusRef.current;
    if (prev === status) return;
    prevStatusRef.current = status;
    if (status === "none") setPulse("unfollow");
    else if (status === "friends") setPulse("friend");
    else setPulse("follow");
  }, [status]);

  // The ring is a one-shot: auto-clear once its animation has played.
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 650);
    return () => clearTimeout(t);
  }, [pulse]);

  if (isOwnProfile) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      await subscribe(userId);
      toast.success("Вы подписались");
    } catch {
      toast.error("Ошибка подписки");
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    try {
      await unsubscribe(userId);
      toast.success("Вы отписались");
    } catch {
      toast.error("Ошибка отписки");
    } finally {
      setLoading(false);
    }
  };

  const isFriend = status === "friends";
  const isFollowing = status === "subscribed" || isFriend;

  const icon = isFriend ? (
    <Users className="h-4 w-4" />
  ) : status === "none" ? (
    <Plus className="h-4 w-4" />
  ) : (
    <Check className="h-4 w-4" />
  );

  // Hover only tints the control: accent to follow, destructive to unfollow.
  const tone =
    status === "none"
      ? "hover:border-primary/40 hover:text-primary"
      : isFriend
        ? "text-primary"
        : "hover:border-destructive/40 hover:text-destructive";

  const title =
    status === "none"
      ? followsYou
        ? "Подписан(а) на вас · подписаться"
        : "Подписаться"
      : isFriend
        ? "Вы друзья"
        : "Вы подписаны";

  const labelText =
    status === "none"
      ? followsYou
        ? "Подписан(а) на вас"
        : "Подписаться"
      : isFriend
        ? "Вы друзья"
        : "Вы подписаны";

  const button = withLabel ? (
    <Button
      variant="outline"
      disabled={loading}
      onClick={isFollowing ? undefined : handleSubscribe}
      title={title}
      className={`h-9 w-full gap-1.5 rounded-xl border-border/60 px-4 text-sm font-medium outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
        isFollowing
          ? "text-muted-foreground hover:border-destructive/40 hover:text-destructive"
          : "hover:border-primary/40 hover:text-primary"
      } ${className ?? ""}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={status} {...ICON_ANIM} className="flex items-center justify-center">
          {icon}
        </motion.span>
      </AnimatePresence>
      <span>{labelText}</span>
    </Button>
  ) : (
    <Button
      variant="outline"
      size="icon"
      disabled={loading}
      onClick={isFollowing ? undefined : handleSubscribe}
      title={title}
      className={`${ACTION_BTN} ${tone} ${className ?? ""}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={status} {...ICON_ANIM} className="flex items-center justify-center">
          {icon}
        </motion.span>
      </AnimatePresence>
    </Button>
  );

  return (
    <span className="relative inline-flex">
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          if (!open) {
            // Always honour a close: if the state flips to non-friend while the
            // menu is open (e.g. after «Отписаться»), a gated close would leave
            // it stuck open and it would pop again on the next subscribe.
            setMenuOpen(false);
            return;
          }
          // Only open if the relationship was already a follow when the press
          // started — a subscribe click that turns mutual must not trigger it.
          if (menuAllowedRef.current) setMenuOpen(true);
          menuAllowedRef.current = false;
        }}
      >
        <DropdownMenuTrigger
          asChild
          onPointerDown={() => {
            menuAllowedRef.current = isFollowing;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") menuAllowedRef.current = isFollowing;
          }}
        >
          {button}
        </DropdownMenuTrigger>
        {isFollowing && (
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleUnsubscribe}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <UserMinus className="h-4 w-4" />
              Отписаться
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* One-shot confirmation ring — expands a little and fades from the edge. */}
      <AnimatePresence>
        {pulse && (
          <motion.span
            key={pulse}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 rounded-xl ring-1 ${PULSE_RING[pulse]}`}
            initial={{ opacity: 0.35, scale: 1 }}
            animate={{ opacity: 0, scale: 1.28 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </span>
  );
};
