import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  Flame,
  Gift,
  Heart,
  HeartHandshake,
  Loader2,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  PenLine,
  RefreshCw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ContentEnter } from "@/components/motion/ContentEnter";
import { useMotionOff } from "@/hooks/useTransitionStyle";
import { pressFeedback, springFor } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CurrencyIcon } from "@/components/CurrencyIcon";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import {
  useDailyQuests,
  dailyErrorStatus,
  dailySeenKey,
  type DailyQuest,
  type DailyReward,
} from "@/hooks/useDailyQuests";
import { ChestOpenModal } from "@/components/ChestOpenModal";
import { useAuth } from "@/hooks/useAuth";

const ICONS: Record<string, LucideIcon> = {
  daily_likes: Heart,
  daily_comments: MessagesSquare,
  daily_wall: PenLine,
  daily_follows: UserPlus,
  daily_thread: MessageSquare,
  daily_entries: NotebookPen,
  daily_media: Camera,
  daily_likes_received: HeartHandshake,
};

function DailyIcon({ questKey, className }: { questKey: string; className?: string }) {
  const Icon = ICONS[questKey] ?? CalendarDays;
  return <Icon className={className} />;
}

function RewardChip({ reward }: { reward: DailyReward }) {
  const { t } = useTranslation();
  if (reward.kind === "drops" || reward.kind === "gems") {
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

function DayProgressBar({ value, max, label, reduce }: { value: number; max: number; label: string; reduce: boolean | null }) {
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

/**
 * One day quest: icon, name, description, progress bar, reward chips and the
 * claim zone on the right (counter → claim button → sealed «Забрано»).
 */
function DailyCard({
  quest,
  isOwner,
  claiming,
  onClaim,
}: {
  quest: DailyQuest;
  isOwner: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const done = quest.completed;
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-surface">
      <div className="flex gap-3 px-4 py-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <DailyIcon questKey={quest.key} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t(quest.name_key)}</p>
          <p className="truncate text-xs text-muted-foreground">{t(quest.desc_key)}</p>
          {!quest.claimed && (
            <div className="mt-1.5">
              <DayProgressBar
                value={quest.progress}
                max={quest.threshold}
                label={`${t(quest.name_key)}: ${Math.min(quest.progress, quest.threshold)}/${quest.threshold}`}
                reduce={reduce}
              />
            </div>
          )}
          {!quest.claimed && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {quest.rewards.map((r, i) => (
                <RewardChip key={`${r.kind}-${i}`} reward={r} />
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end justify-center">
          {quest.can_claim && isOwner ? (
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
          ) : quest.claimed || quest.completed ? (
            <motion.span
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={springFor("pop", reduce)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <Check className="h-3.5 w-3.5 text-primary" />
              {t("quests.claimed")}
            </motion.span>
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {Math.min(quest.progress, quest.threshold)}/{quest.threshold}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Yesterday's auto-grant as one toast line ("Вчерашнее долетело: +40
 * дропсов, сундук"). Null when there is nothing to announce — the chest, if
 * any, is already sitting in the vault below, ready to open.
 */
export function formatAutoGranted(
  t: (key: string, opts?: Record<string, unknown>) => string,
  granted: DailyReward[],
): string | null {
  if (granted.length === 0) return null;
  const parts: string[] = [];
  const dropsWon = granted
    .filter((g) => g.kind === "drops")
    .reduce((sum, g) => sum + (g.amount ?? 0), 0);
  if (dropsWon > 0) parts.push(t("quests.claimedDrops", { count: dropsWon, label: formatDropsLabel(dropsWon) }));
  if (granted.some((g) => g.kind === "chest")) parts.push(t("quests.chest"));
  if (parts.length === 0) return null;
  return `${t("quests.daily.autoTitle")}: ${parts.join(", ")}`;
}

/**
 * Daily quests screen: today's three (deterministic per server date), the
 * streak header, the bought-back-series banner and the day-chest vault.
 * The set is seen-marked on load so the quests-page button can raise its
 * «!» for unvisited days only.
 */
export default function DailyQuests() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const motionOff = useMotionOff();
  const {
    day,
    quests,
    unclaimed,
    fullClaimed,
    streak,
    chests,
    drops,
    autoGranted,
    loading,
    claim,
    restore,
    openChest,
    reload,
    applyClaim,
    applyRestore,
    applyChestOpen,
  } = useDailyQuests(user?.id);
  const isOwner = Boolean(user?.id);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [openChestModal, setOpenChestModal] = useState<{ id: string } | null>(null);
  const inflight = useRef<Set<string>>(new Set());

  const doneCount = useMemo(() => quests.filter((q) => q.completed).length, [quests]);

  // Seen-mark: the entrance button's «!» means «new set, never opened».
  useEffect(() => {
    if (!user?.id || !day) return;
    try {
      localStorage.setItem(dailySeenKey(user.id), day);
    } catch {
      /* ignore */
    }
  }, [user?.id, day]);

  // Yesterday's auto-grant, announced once per day: settle credited it just
  // now (repeats return nothing new), so one toast per day is exact.
  const autoToastDay = useRef<string | null>(null);
  useEffect(() => {
    if (!day || autoGranted.length === 0 || autoToastDay.current === day) return;
    autoToastDay.current = day;
    const text = formatAutoGranted(t, autoGranted);
    if (text) toast.success(text);
  }, [day, autoGranted, t]);

  const handleClaim = async (quest: DailyQuest) => {
    if (inflight.current.has(quest.key)) return;
    inflight.current.add(quest.key);
    setClaimingKey(quest.key);
    try {
      const granted = await claim(quest.key);
      applyClaim(quest.key, granted);
      const dropsWon = granted
        .filter((g) => g.kind === "drops")
        .reduce((sum, g) => sum + (g.amount ?? 0), 0);
      const chestWon = granted.some((g) => g.kind === "chest");
      const parts: string[] = [];
      if (dropsWon > 0) parts.push(t("quests.claimedDrops", { count: dropsWon, label: formatDropsLabel(dropsWon) }));
      if (chestWon) parts.push(t("quests.chest"));
      toast.success(parts.length > 0 ? parts.join(", ") : t("quests.claimedDone"));
    } catch (err) {
      const status = dailyErrorStatus(err);
      await reload();
      if (status === 409) {
        toast.message(t("quests.alreadyClaimed"));
      } else if (status !== 422) {
        toast.error(t("quests.claimFailed"));
      }
    } finally {
      inflight.current.delete(quest.key);
      setClaimingKey(null);
    }
  };

  const handleRestore = async () => {
    if (restoring || !streak.restorable_day || !streak.restore_price) return;
    setRestoring(true);
    try {
      const res = await restore();
      applyRestore(res.price);
      toast.success(t("quests.daily.restoreDone", { count: streak.current }));
    } catch (err) {
      if (dailyErrorStatus(err) === 402) {
        toast.error(t("quests.daily.restoreNoDrops"));
      } else {
        toast.error(t("quests.daily.restoreFailed"));
      }
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenChest = (id: string) => {
    const key = `chest:${id}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    // The play call fires on modal mount and credits at once: opening the
    // modal IS starting, there is no backing out of the ceremony.
    setOpenChestModal({ id });
  };

  const closeChestModal = () => {
    setOpenChestModal((m) => {
      if (m) inflight.current.delete(`chest:${m.id}`);
      return null;
    });
  };

  const expireChestModal = () => {
    setOpenChestModal((m) => {
      if (m) {
        inflight.current.delete(`chest:${m.id}`);
        applyChestOpen(m.id, 0);
        void reload();
      }
      return null;
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2 sm:px-6">
      <ContentEnter>
        <header>
          <Link
            to={`/achievements/${user?.id ?? "me"}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("quests.daily.back")}
          </Link>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{t("quests.daily.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("quests.daily.subtitle", { done: doneCount, total: quests.length })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-0.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-3 py-1 text-xs font-medium tabular-nums">
                <Flame className={cn("h-3.5 w-3.5", streak.current > 0 ? "text-amber-500" : "text-muted-foreground")} />
                {streak.current}
              </span>
              <AnimatePresence initial={false}>
                {unclaimed > 0 && (
                  <motion.span
                    key={unclaimed}
                    initial={motionOff ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={springFor("pop", null)}
                    className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground tabular-nums"
                  >
                    {t("quests.unclaimed", { count: unclaimed })}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>
      </ContentEnter>

      <div className="mt-8 space-y-4">
        {streak.restorable_day && streak.restore_price ? (
          <section
            aria-label={t("quests.daily.restoreTitle")}
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
          >
            <h2 className="text-sm font-semibold">{t("quests.daily.restoreTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("quests.daily.restoreText", {
                price: streak.restore_price,
                label: formatDropsLabel(streak.restore_price),
              })}
            </p>
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={restoring || drops < streak.restore_price}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-60"
            >
              <RefreshCw className={cn("h-4 w-4", restoring && "animate-spin")} />
              {t("quests.daily.restoreButton")}
            </button>
          </section>
        ) : null}

        {quests.map((quest) => (
          <DailyCard
            key={quest.key}
            quest={quest}
            isOwner={isOwner}
            claiming={claimingKey === quest.key}
            onClaim={() => void handleClaim(quest)}
          />
        ))}

        {fullClaimed && chests.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">{t("quests.daily.dayClosed")}</p>
        )}

        {isOwner && chests.length > 0 && (
          <section aria-label={t("quests.chestsSection", { count: chests.length })}>
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("quests.chestsSection", { count: chests.length })}
            </h2>
            <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-surface">
              {chests.map((ch) => (
                <div key={ch.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t("quests.chestName")}</p>
                    <p className="truncate text-xs text-muted-foreground">{t("quests.daily.chestFromDay")}</p>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => handleOpenChest(ch.id)}
                    disabled={openChestModal?.id === ch.id}
                    {...pressFeedback(null)}
                    transition={springFor("snappy", null)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
                  >
                    {openChestModal?.id === ch.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    {t("quests.open")}
                  </motion.button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {openChestModal && (
        <ChestOpenModal
          title={t("quests.daily.chestFromDay")}
          openChest={() => openChest(openChestModal.id)}
          onApplied={(won) => applyChestOpen(openChestModal.id, won)}
          onExpired={expireChestModal}
          onClose={closeChestModal}
        />
      )}
    </main>
  );
}
