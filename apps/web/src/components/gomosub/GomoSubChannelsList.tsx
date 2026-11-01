import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Hash, Lock, MessageSquare } from "lucide-react";
import { NavigationLink } from "@/components/NavigationLink";
import { cn } from "@/lib/utils";
import { springFor } from "@/lib/motion";

export interface ChannelLike {
  id: string;
  slug: string;
  name: string;
  is_private: boolean;
  kind?: "forum" | "text";
}

export interface GroupedChannels {
  category: string;
  channels: ChannelLike[];
}

interface GomoSubChannelsListProps {
  /** Base slug of the community, e.g. `tech`. */
  boardSlug: string;
  groups: GroupedChannels[];
  /** Slug of the active channel. */
  activeChannelSlug: string | null;
  /** Called after any channel navigation (closes the mobile sheet). */
  onNavigate?: () => void;
  /** Channel ids with unseen activity (unread dots). */
  unread?: Set<string>;
  /** Substring filter from the channel search (mobile sheet / sidebar). */
  query?: string;
  className?: string;
}

/** Row glyphs are semantic: # forum-threads, chat bubble — live chat. */
const ChannelGlyph = ({
  channel,
  active,
}: {
  channel: ChannelLike;
  active: boolean;
}) => {
  if (channel.is_private && channel.kind !== "text") {
    return <Lock className="w-4 h-4 shrink-0 text-amber-500" />;
  }
  if (channel.kind === "text") {
    return (
      <MessageSquare className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "text-sky-400")} />
    );
  }
  return (
    <Hash
      className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground")}
    />
  );
};

/**
 * Grouped channel list shared by the desktop sidebar and the mobile sheet —
 * one markup for both so the two never drift.
 *
 * Discord reads: uppercase section headers, a sliding active pill (shared
 * layoutId on a spring, so switching channels glides instead of blinking),
 * and a spring-pop unread dot. Rows shrink on press for tactility.
 */
export const GomoSubChannelsList = memo(
  ({
    boardSlug,
    groups,
    activeChannelSlug,
    onNavigate,
    unread,
    query,
    className,
  }: GomoSubChannelsListProps) => {
    const reduce = useReducedMotion();
    const q = (query ?? "").trim().toLowerCase();
    const visible = useMemo(() => {
      if (!q) return groups;
      return groups
        .map((g) => ({
          ...g,
          channels: g.channels.filter((ch) => ch.name.toLowerCase().includes(q)),
        }))
        .filter((g) => g.channels.length > 0);
    }, [groups, q]);

    const rowState = (active: boolean) =>
      active
        ? "bg-primary/10 text-primary font-medium"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground";

    if (visible.length === 0) {
      return (
        <div className="px-2.5 py-6 text-center text-sm text-muted-foreground">
          Ничего не найдено
        </div>
      );
    }

    return (
      <nav className={cn("space-y-0.5", className)} aria-label="Каналы сообщества">
        {visible.map((group) => (
          <div key={group.category || "__uncategorized"} className="mt-2 first:mt-0">
            {group.category && (
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 truncate">
                {group.category}
              </div>
            )}
            {group.channels.map((ch) => {
              const active = activeChannelSlug === ch.slug;
              return (
                <NavigationLink
                  key={ch.id}
                  to={`/g/${boardSlug}/c/${ch.slug}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors active:scale-[0.98]",
                    rowState(active),
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="gomosub-channel-active"
                      transition={springFor("snappy", reduce)}
                      className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-primary"
                    />
                  )}
                  <ChannelGlyph channel={ch} active={active} />
                  <span className="truncate">{ch.name}</span>
                  {!active && unread?.has(ch.id) && (
                    <motion.span
                      aria-label="Есть новое"
                      initial={reduce ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={springFor("pop", reduce)}
                      className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </NavigationLink>
              );
            })}
          </div>
        ))}
      </nav>
    );
  },
);

GomoSubChannelsList.displayName = "GomoSubChannelsList";
