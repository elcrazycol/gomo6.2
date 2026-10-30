import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  Flag,
  Gift,
  Heart,
  HeartHandshake,
  IdCard,
  Loader2,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  Palette,
  PenLine,
  Smile,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ContentEnter } from "@/components/motion/ContentEnter";
import { useMotionOff } from "@/hooks/useTransitionStyle";
import { EASE_OUT_EXPO, pressFeedback, springFor, whisperRowVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CurrencyIcon } from "@/components/CurrencyIcon";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { formatGemsLabel } from "@/utils/formatGemsLabel";
import { useQuests, questErrorStatus, type Quest, type QuestLevel, type QuestReward, type QuestChest } from "@/hooks/useQuests";
import { refreshUnclaimedCount } from "@/hooks/useUnclaimedRewards";
import { useAuth } from "@/hooks/useAuth";
import { loadAchievementsProfile } from "@/routes/data/achievementsData";
import { isPublicId } from "@/utils/entityUrl";

const ICONS: Record<string, LucideIcon> = {
  smile: Smile,
  "id-card": IdCard,
  "message-square": MessageSquare,
  "pen-line": PenLine,
  "messages-square": MessagesSquare,
  heart: Heart,
  "heart-handshake": HeartHandshake,
  users: Users,
  "user-plus": UserPlus,
  palette: Palette,
  trophy: Trophy,
  "notebook-pen": NotebookPen,
  flag: Flag,
};

function QuestIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}

/**
 * A quest row arriving with the shared whisper cascade (arrive, not
 * perform): for reduced motion and the app's motion-off switch it degrades
 * to a plain div with the same end state.
 */
function CascadeRow({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const motionOff = useMotionOff();
  if (motionOff || reduce) return <div>{children}</div>;
  return (
    <motion.div variants={whisperRowVariants(index)} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

function RewardChip({ reward }: { reward: QuestReward }) {
  const { t } = useTranslation();
  if (reward.kind === "gems" || reward.kind === "drops") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
        <CurrencyIcon kind={reward.kind} className="h-3 w-3" />
        {reward.amount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
      <Gift className="h-3 w-3" />
      {t("quests.chest")}
    </span>
  );
}

/**
 * Thin progress meter. The fill rides `scaleX` on the soft spring of large
 * surfaces — never a tweened width, which would reflow every frame.
 */
function ProgressBar({ value, max, label, reduce }: { value: number; max: number; label: string; reduce: boolean | null }) {
  const pct = Math.max(0, Math.min(1, value / Math.max(max, 1)));
  return (
    <div
      className="h-1 w-36 max-w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <motion.div
        className="h-full w-full rounded-full bg-primary"
        style={{ originX: 0 }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: pct }}
        transition={springFor("soft", reduce)}
      />
    </div>
  );
}

/** Compact primary action for claiming a reached reward. */
function ClaimButton({ claiming, onClaim }: { claiming: boolean; onClaim: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClaim}
      disabled={claiming}
      {...pressFeedback(reduce)}
      transition={springFor("snappy", reduce)}
      className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
    >
      {claiming && <Loader2 className="h-3 w-3 animate-spin" />}
      {t("quests.claim")}
    </motion.button>
  );
}

/** The quiet «Забрано» seal that pops in once a reward has landed. */
function ClaimedChip({ reduce }: { reduce: boolean | null }) {
  const { t } = useTranslation();
  return (
    <motion.span
      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springFor("pop", reduce)}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
    >
      <Check className="h-3.5 w-3.5 text-primary" />
      {t("quests.claimed")}
    </motion.span>
  );
}

/** Right side of a quest row: counter → claim button → claimed seal. */
function RowStatus({
  level,
  progress,
  isOwner,
  claiming,
  onClaim,
  reduce,
}: {
  level: QuestLevel;
  progress: number;
  isOwner: boolean;
  claiming: boolean;
  onClaim: () => void;
  reduce: boolean | null;
}) {
  if (level.can_claim && isOwner) {
    return <ClaimButton claiming={claiming} onClaim={onClaim} />;
  }
  if (level.claimed || level.completed) {
    return <ClaimedChip reduce={reduce} />;
  }
  return (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {Math.min(progress, level.threshold)}/{level.threshold}
    </span>
  );
}

/** Shared reward-chip row under a quest description. */
function RewardChips({ rewards, hidden }: { rewards: QuestReward[]; hidden?: boolean }) {
  if (hidden || rewards.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {rewards.map((r, i) => (
        <RewardChip key={`${r.kind}-${i}`} reward={r} />
      ))}
    </div>
  );
}

/**
 * A row of the «Первые шаги» checklist: icon tile, quest title, description,
 * right-side status. One card, hairline separators — no scattered tiles.
 */
function FirstStepRow({
  quest,
  index,
  isOwner,
  claiming,
  onClaim,
}: {
  quest: Quest;
  index: number;
  isOwner: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  const { t } = useTranslation();
  const level = quest.levels[0];
  const reduce = useReducedMotion();
  if (!level) return null;
  const done = level.completed;
  return (
    <CascadeRow index={index}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <QuestIcon name={quest.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", done && !level.can_claim && "text-muted-foreground")}>
            {t(level.name_key)}
          </p>
          <p className="truncate text-xs text-muted-foreground">{t(level.description_key)}</p>
          <RewardChips rewards={level.rewards} hidden={level.claimed} />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <RowStatus level={level} progress={quest.progress_current} isOwner={isOwner} claiming={claiming} onClaim={onClaim} reduce={reduce} />
        </div>
      </div>
    </CascadeRow>
  );
}

/**
 * One rung of a quest ladder: numbered dot on a rail, title, description,
 * progress bar and status. Reached-but-unclaimed rungs pop; future rungs
 * stay dim. The rail connector lives in the dot column so it survives any
 * row height.
 */
function LadderRow({
  quest,
  level,
  index,
  isLast,
  isOwner,
  claiming,
  onClaim,
}: {
  quest: Quest;
  level: QuestLevel;
  index: number;
  isLast: boolean;
  isOwner: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  // Future = levels beyond the one currently being worked on (the next
  // level after `current_level` is the active one, never dimmed).
  const future = !level.completed && level.level > quest.current_level + 1;
  const claimed = level.claimed;
  const claimable = level.can_claim;
  return (
    <CascadeRow index={index}>
      <div className={cn("flex gap-3 px-4 py-3", claimable && "bg-primary/[0.04]")}>
        {/* Dot + rail column: the connector stretches under the dot, so the
            ladder reads as one line no matter how tall a row grows. */}
        <div className="flex w-6 shrink-0 flex-col items-center">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
              claimable && "bg-primary text-primary-foreground ring-4 ring-primary/10",
              claimed && !claimable && "bg-primary/15 text-primary",
              !claimed && !claimable && !future && "bg-surface text-primary ring-1 ring-primary/30",
              future && "bg-muted text-muted-foreground",
            )}
          >
            {claimed || claimable ? <Check className="h-3.5 w-3.5" /> : level.level}
          </span>
          {!isLast && <span aria-hidden className="min-h-2 w-px flex-1 bg-border/60" />}
        </div>
        <div className={cn("min-w-0 flex-1", future && "opacity-60")}>
          <p className={cn("truncate text-sm font-medium", claimed && "text-muted-foreground")}>
            {t(level.name_key)}
          </p>
          <p className={cn("truncate text-xs", claimed ? "text-muted-foreground/80" : "text-muted-foreground")}>
            {t(level.description_key)}
          </p>
          {!claimed && !claimable && quest.progress_current > 0 && (
            <ProgressBar
              value={quest.progress_current}
              max={level.threshold}
              label={`${t(level.name_key)}: ${Math.min(quest.progress_current, level.threshold)}/${level.threshold}`}
              reduce={reduce}
            />
          )}
          <RewardChips rewards={level.rewards} hidden={claimed} />
        </div>
        <div className={cn("flex shrink-0 flex-col items-end", future && "opacity-60")}>
          <RowStatus level={level} progress={quest.progress_current} isOwner={isOwner} claiming={claiming} onClaim={onClaim} reduce={reduce} />
        </div>
      </div>
    </CascadeRow>
  );
}

/**
 * A chest waiting in the vault. Arrives with the cascade and lifts out on
 * exit, so opening it reads as removing one card, not an instant swap.
 */
function ChestRow({
  chest,
  index,
  claiming,
  onOpen,
}: {
  chest: QuestChest;
  index: number;
  claiming: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const motionOff = useMotionOff();
  const skipMotion = motionOff || reduce;
  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Gift className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t("quests.chestName")}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t(chest.quest_key ? `achievements.${chest.quest_key}.title` : "quests.chestFallback")}
        </p>
      </div>
      <motion.button
        type="button"
        onClick={onOpen}
        disabled={claiming}
        {...pressFeedback(reduce)}
        transition={springFor("snappy", reduce)}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
      >
        {claiming && <Loader2 className="h-3 w-3 animate-spin" />}
        {t("quests.open")}
      </motion.button>
    </div>
  );
  if (skipMotion) return <div>{body}</div>;
  return (
    <motion.div
      variants={whisperRowVariants(index)}
      initial="hidden"
      animate="show"
      transition={springFor("snappy", reduce)}
      exit={{
        opacity: 0,
        scale: 0.96,
        y: -6,
        transition: {
          ...springFor("snappy", reduce),
          opacity: { duration: 0.12, ease: EASE_OUT_EXPO },
        },
      }}
    >
      {body}
    </motion.div>
  );
}

/** The drops balance. It pops only on a real change after mount, never on
 * the first render (counters must not perform «loading»), and is skipped
 * entirely in tests and under reduced motion. */
function DropsChip({ drops }: { drops: number }) {
  const reduce = useReducedMotion();
  const skipMotion = reduce || import.meta.env.MODE === "test";
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-3 py-1 text-xs font-medium tabular-nums">
      <CurrencyIcon kind="drops" className="h-3.5 w-3.5" />
      <motion.span
        key={drops}
        initial={mounted.current && !skipMotion ? { scale: 1.35 } : false}
        animate={{ scale: 1 }}
        transition={springFor("pop", reduce)}
        className="inline-block"
      >
        {drops}
      </motion.span>
    </span>
  );
}

/**
 * Quest page, redesigned as one calm column: header with the balance chips,
 * then the chests vault, the «Первые шаги» checklist (a single card of
 * hairline-separated rows) and one card per quest group with its level
 * ladder on a rail. Every reached level is claimable by the owner; guests
 * and other users see progress only.
 */
export default function Achievements() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ id: string; username: string } | null>(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(userId));
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    loadAchievementsProfile(userId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const trophyUserId =
    profile?.id ?? (userId && isPublicId(userId) ? undefined : userId);
  const { quests, chests, drops, unclaimedCount, loading, claim, openChest, reload, applyClaim, applyChestOpen } =
    useQuests(trophyUserId);
  const isOwner = Boolean(user?.id && trophyUserId && user.id === trophyUserId);
  // In-flight claim/open guard: state-driven `disabled` flips only after a
  // re-render, so a fast double click fires two POSTs — the second gets a 409
  // while the first already granted. The ref blocks the second synchronously.
  const inflight = useRef<Set<string>>(new Set());

  const firstSteps = useMemo(
    () => quests.filter((q) => q.track === "first_steps").sort((a, b) => a.sort_order - b.sort_order),
    [quests],
  );
  const main = useMemo(
    () => quests.filter((q) => q.track !== "first_steps").sort((a, b) => a.sort_order - b.sort_order),
    [quests],
  );
  const doneSteps = useMemo(
    () => firstSteps.filter((q) => q.current_level > 0).length,
    [firstSteps],
  );

  const handleClaim = async (quest: Quest, level: QuestLevel) => {
    const key = `${quest.group_key}:${level.level}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setClaimingKey(key);
    try {
      const granted = await claim(quest.group_key, level.level);
      // Surgical patch — no refetch, the row flips in place with animation.
      applyClaim(quest.group_key, level.level, granted);
      // The header/sidebar badge reads a shared entry — drop it at once.
      refreshUnclaimedCount(user?.id);
      const dropsWon = granted
        .filter((g) => g.kind === "drops")
        .reduce((sum, g) => sum + (g.amount ?? 0), 0);
      const gemsWon = granted
        .filter((g) => g.kind === "gems")
        .reduce((sum, g) => sum + (g.amount ?? 0), 0);
      const chestsWon = granted.filter((g) => g.kind === "chest").length;
      const parts: string[] = [];
      if (dropsWon > 0) parts.push(t("quests.claimedDrops", { count: dropsWon, label: formatDropsLabel(dropsWon) }));
      if (gemsWon > 0) parts.push(t("quests.claimedGems", { count: gemsWon, label: formatGemsLabel(gemsWon) }));
      if (chestsWon > 0) parts.push(t("quests.chest"));
      toast.success(parts.length > 0 ? parts.join(", ") : t("quests.claimedDone"));
    } catch (err) {
      // 409 = the reward is already claimed (parallel click, retry after a
      // success whose response was lost): not an error, just re-sync state.
      // 422 = progress moved (e.g. rules changed): re-sync too.
      const status = questErrorStatus(err);
      await reload();
      refreshUnclaimedCount(user?.id);
      if (status === 409) {
        toast.message(t("quests.alreadyClaimed"));
      } else if (status !== 422) {
        toast.error(t("quests.claimFailed"));
      }
    } finally {
      inflight.current.delete(key);
      setClaimingKey(null);
    }
  };

  const handleOpenChest = async (id: string) => {
    const key = `chest:${id}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setClaimingKey(key);
    try {
      const res = await openChest(id);
      applyChestOpen(id, res.drops);
      toast.success(t("quests.chestOpened", { count: res.drops, label: formatDropsLabel(res.drops) }));
    } catch (err) {
      await reload();
      if (questErrorStatus(err) !== 409) {
        toast.error(t("quests.openFailed"));
      }
    } finally {
      inflight.current.delete(key);
      setClaimingKey(null);
    }
  };

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const firstStepsHeading = t("quests.firstSteps", { done: doneSteps, total: firstSteps.length });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2 sm:px-6">
      <ContentEnter>
        <header>
          <Link
            to={`/profile/${userId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {profile
              ? t("achievements.backToProfile", { username: profile.username })
              : t("achievements.back")}
          </Link>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">
                {t("quests.title")}
                {profile && ` — ${profile.username}`}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("quests.subtitle", { done: doneSteps, total: firstSteps.length })}
              </p>
            </div>
            {isOwner && (
              <div className="flex shrink-0 items-center gap-2 pb-0.5">
                <DropsChip drops={drops} />
                <AnimatePresence initial={false}>
                  {unclaimedCount > 0 && (
                    <motion.span
                      key={unclaimedCount}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={springFor("pop", null)}
                      className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground tabular-nums"
                    >
                      {t("quests.unclaimed", { count: unclaimedCount })}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </header>
      </ContentEnter>

      <div className="mt-8 space-y-9">
        {isOwner && chests.length > 0 && (
          <section aria-label={t("quests.chestsSection", { count: chests.length })}>
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("quests.chestsSection", { count: chests.length })}
            </h2>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface">
              <AnimatePresence initial={false}>
                {chests.map((ch, i) => (
                  <ChestRow
                    key={ch.id}
                    chest={ch}
                    index={i}
                    claiming={claimingKey === `chest:${ch.id}`}
                    onOpen={() => void handleOpenChest(ch.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {firstSteps.length > 0 && (
          <section aria-label={firstStepsHeading}>
            <h2 className="text-sm font-medium text-muted-foreground">{firstStepsHeading}</h2>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface">
              {firstSteps.map((quest, i) => {
                const level = quest.levels[0];
                if (!level) return null;
                return (
                  <FirstStepRow
                    key={quest.group_key}
                    quest={quest}
                    index={i}
                    isOwner={isOwner}
                    claiming={claimingKey === `${quest.group_key}:${level.level}`}
                    onClaim={() => void handleClaim(quest, level)}
                  />
                );
              })}
            </div>
          </section>
        )}

        {main.length > 0 && (
          <section aria-label={t("quests.mainLadder")}>
            <h2 className="text-sm font-medium text-muted-foreground">{t("quests.mainLadder")}</h2>
            <div className="mt-3 space-y-4">
              {main.map((quest) => (
                <div
                  key={quest.group_key}
                  className="overflow-hidden rounded-xl border border-border/60 bg-surface"
                >
                  <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <QuestIcon name={quest.icon} className="h-4 w-4" />
                    </div>
                    <h3 className="min-w-0 truncate text-sm font-medium">{t(quest.title_key)}</h3>
                  </div>
                  <div className="divide-y divide-border/60">
                    {quest.levels.map((level, li) => (
                      <LadderRow
                        key={level.level}
                        quest={quest}
                        level={level}
                        index={li}
                        isLast={li === quest.levels.length - 1}
                        isOwner={isOwner}
                        claiming={claimingKey === `${quest.group_key}:${level.level}`}
                        onClaim={() => void handleClaim(quest, level)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {quests.length === 0 && (
          <ContentEnter className="flex flex-col items-center gap-2 py-16 text-center">
            <Trophy aria-hidden className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("achievements.noTrophies")}</p>
          </ContentEnter>
        )}
      </div>
    </main>
  );
}
