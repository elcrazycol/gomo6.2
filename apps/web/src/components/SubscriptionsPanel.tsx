import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SubscriptionList } from "@/components/SubscriptionList";
import { useFriendsStore } from "@/stores/friendsStore";
import { transitionEnterClass } from "@/lib/viewTransitions";
import { useTransitionStyle } from "@/hooks/useTransitionStyle";

type Mode = "subscribers" | "subscriptions";

/**
 * Single profile section for the social graph: a minimal segmented toggle
 * switches between the people who follow this user (Подписчики) and the people
 * this user follows (Подписки).
 *
 * Both lists are loaded up front and the panel renders only once the current
 * one is ready — so it opens fully formed instead of swapping or flashing. The
 * header loading bar is the only loading indicator.
 */
export const SubscriptionsPanel = ({ userId, limit }: { userId: string; limit?: number }) => {
  const { t } = useTranslation();
  const transitionStyle = useTransitionStyle();
  const [mode, setMode] = useState<Mode>("subscribers");

  const profileSubscribers = useFriendsStore((s) => s.profileSubscribers);
  const profileSubscriptions = useFriendsStore((s) => s.profileSubscriptions);
  const profileSubscribersFor = useFriendsStore((s) => s.profileSubscribersFor);
  const profileSubscriptionsFor = useFriendsStore((s) => s.profileSubscriptionsFor);
  const fetchProfileSubscribers = useFriendsStore((s) => s.fetchProfileSubscribers);
  const fetchProfileSubscriptions = useFriendsStore((s) => s.fetchProfileSubscriptions);

  // Preload both directions so switching the toggle never fetches on the spot.
  useEffect(() => {
    if (!userId) return;
    fetchProfileSubscribers(userId);
    fetchProfileSubscriptions(userId);
  }, [userId, fetchProfileSubscribers, fetchProfileSubscriptions]);

  const ready =
    mode === "subscribers"
      ? profileSubscribersFor === userId
      : profileSubscriptionsFor === userId;

  // Nothing until the current list has loaded — avoids any partial render.
  if (!ready) return null;

  const segments: { key: Mode; label: string; count: number | null }[] = [
    {
      key: "subscribers",
      label: t("profile.subscribers"),
      count: profileSubscribersFor === userId ? profileSubscribers.length : null,
    },
    {
      key: "subscriptions",
      label: t("profile.subscriptions"),
      count: profileSubscriptionsFor === userId ? profileSubscriptions.length : null,
    },
  ];

  return (
    <div className={transitionEnterClass(transitionStyle)}>
      <div className="mb-3 flex flex-wrap items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
        {segments.map((segment) => {
          const active = mode === segment.key;
          return (
            <button
              key={segment.key}
              type="button"
              onClick={() => setMode(segment.key)}
              className={`relative rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="subscriptions-panel-toggle"
                  className="absolute inset-0 rounded-full bg-background shadow-sm"
                  transition={{ type: "spring", stiffness: 450, damping: 36 }}
                />
              )}
              <span className="relative z-10">
                {segment.label}
                {segment.count != null && (
                  <span className="ml-1 text-muted-foreground">{segment.count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <SubscriptionList kind={mode} limit={limit} />
    </div>
  );
};
