import { memo } from "react";
import { Hash, Lock, MessageSquare } from "lucide-react";
import { NavigationLink } from "@/components/NavigationLink";
import { cn } from "@/lib/utils";

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
  /** Called after any channel navigation (closes the mobile drawer). */
  onNavigate?: () => void;
  /** Channel ids with unseen activity (unread dots). */
  unread?: Set<string>;
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
 * Grouped channel list shared by the desktop sidebar and the mobile drawer —
 * one markup for both so the two never drift.
 */
export const GomoSubChannelsList = memo(
  ({
    boardSlug,
    groups,
    activeChannelSlug,
    onNavigate,
    unread,
    className,
  }: GomoSubChannelsListProps) => {
    const rowState = (active: boolean) =>
      active
        ? "bg-primary/10 text-primary font-medium"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground";

    return (
      <nav className={cn("space-y-0.5", className)} aria-label="Каналы сообщества">
        {groups.map((group) => (
          <div key={group.category || "__uncategorized"} className="mt-2">
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
                  className={cn("group flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors", rowState(active))}
                >
                  <ChannelGlyph channel={ch} active={active} />
                  <span className="truncate">{ch.name}</span>
                  {!active && unread?.has(ch.id) && (
                    <span aria-label="Есть новое" className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />
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
