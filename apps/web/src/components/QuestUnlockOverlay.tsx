import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Gift, Trophy } from "lucide-react";
import { CurrencyIcon } from "@/components/CurrencyIcon";
import { EASE_OUT_EXPO, pressFeedback, springFor, SPRING } from "@/lib/motion";
import { useMotionOff } from "@/hooks/useTransitionStyle";
import { eventManager } from "@/services/eventManager";
import { useAuth } from "@/hooks/useAuth";
import { fetchQuestProgress, type QuestReward } from "@/hooks/useQuests";
import type { Notification } from "@/integrations/api/client";

interface Unlock {
  key: string;
  nameKey: string;
  descKey: string;
  rewards: QuestReward[];
  uid: string;
}

/** How long the toast stays before gliding away on its own. */
const DWELL_MS = 4500;

/** Reward chips — the same tile style as the achievements page. */
function UnlockRewards({ rewards }: { rewards: QuestReward[] }) {
  const { t } = useTranslation();
  if (rewards.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {rewards.map((r, i) => (
        <span
          key={`${r.kind}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums"
        >
          {(r.kind === "gems" || r.kind === "drops") && (
            <>
              <CurrencyIcon kind={r.kind} className="h-3 w-3" />
              {r.amount}
            </>
          )}
          {r.kind === "chest" && (
            <>
              <Gift className="h-3 w-3" />
              {t("quests.chest")}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

const CARD =
  "pointer-events-auto flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-surface/95 p-3.5 shadow-xl backdrop-blur";

/**
 * The toast card: label, what was earned, the rewards — so the eye reads
 * top-down in one pass. Geometry enters on the sheet spring (an overlay from
 * an edge); the fade rides its own short expo tween, never the same curve.
 */
function UnlockToast({ unlock, onGo }: { unlock: Unlock; onGo: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const motionOff = useMotionOff();
  const skipMotion = reduce || motionOff;

  const content = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Trophy className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-xs text-muted-foreground">{t("quests.unlockTitle")}</p>
        <p className="mt-0.5 truncate text-sm font-medium" title={t(unlock.descKey)}>
          {t(unlock.nameKey)}
        </p>
        <UnlockRewards rewards={unlock.rewards} />
      </div>
      {/* Right rail: the action lives in its own zone, clear of the text —
          never squeezed against a truncated name. */}
      <div className="shrink-0 self-center pl-2.5">
        <motion.button
          type="button"
          onClick={onGo}
          {...pressFeedback(reduce)}
          transition={springFor("snappy", reduce)}
          className="inline-flex items-center whitespace-nowrap rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {t("quests.unlockGo")}
        </motion.button>
      </div>
    </>
  );

  if (skipMotion) {
    return (
      <div role="status" className={CARD}>
        {content}
      </div>
    );
  }
  return (
    <motion.div
      role="status"
      className={CARD}
      initial={{ y: 80, scale: 0.97, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      exit={{ y: 44, scale: 0.98, opacity: 0 }}
      transition={{ ...SPRING.sheet, opacity: { duration: 0.18, ease: EASE_OUT_EXPO } }}
    >
      {content}
    </motion.div>
  );
}

/**
 * Quest unlock toast: appears above everything when the server reports a
 * completed level (`achievement_unlock` over WS), shows what the quest is
 * and what it gives, then glides away on its own. A button takes the user to
 * the achievements page to claim — claiming itself stays there. One toast at
 * a time; the next one waits in the queue.
 *
 * The dock sits above the mobile bottom nav (its height + safe area) and
 * back at bottom-6 on ≥sm, where the nav is gone.
 */
export function QuestUnlockOverlay() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [queue, setQueue] = useState<Unlock[]>([]);
  const [current, setCurrent] = useState<Unlock | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setCurrent(null);
  }, []);

  // Feed the queue from WS unlock notifications, resolving display data
  // through the progress endpoint (names, descriptions and rewards live
  // in the catalog, not in the notification payload).
  useEffect(() => {
    const off = eventManager.on("new_notification", (message) => {
      const notif = message.data as Notification | undefined;
      const params = notif?.params as
        | { group_key?: string; level?: number }
        | undefined;
      if (!notif || notif.type !== "achievement_unlock" || !params?.group_key) return;
      const uid = user?.id;
      if (!uid) return;
      const key = `${params.group_key}:${params.level ?? 1}`;
      void fetchQuestProgress(uid)
        .then((data) => {
          const quest = (data.quests ?? []).find((q) => q.group_key === params.group_key);
          const level = quest?.levels.find((l) => l.level === (params.level ?? 1));
          if (!quest || !level) return;
          setQueue((q) => [
            ...q,
            {
              key: `${key}:${Date.now()}`,
              nameKey: level.name_key,
              descKey: level.description_key,
              rewards: level.rewards,
              uid,
            },
          ]);
        })
        .catch(() => {});
    });
    return off;
  }, [user?.id]);

  // Show the head of the queue; auto-dismiss after the dwell time.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setCurrent(head);
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    timer.current = setTimeout(() => setCurrent(null), DWELL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [current]);

  const goToQuests = () => {
    if (!current) return;
    navigate(`/achievements/${current.uid}`);
    dismiss();
  };

  return (
    <AnimatePresence>
      {current && (
        <div
          key={current.key}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[200] flex justify-center px-4 sm:bottom-6 sm:px-6"
        >
          <UnlockToast unlock={current} onGo={goToQuests} />
        </div>
      )}
    </AnimatePresence>
  );
}
