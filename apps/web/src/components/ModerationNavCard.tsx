import { useEffect, useState } from "react";
import { ChevronRight, Gavel } from "lucide-react";

import { PrefetchLink } from "@/components/PrefetchLink";
import { api } from "@/integrations/api/compat";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";

/**
 * Desktop sidebar entry point to the moderation area. Rendered only for helpers,
 * moderators and admins — everyone else sees nothing. Mirrors the other sidebar
 * panels (card surface, --card-radius, leading icon, trailing chevron) and rides
 * the shared 5-minute meta cache, so it costs no extra requests.
 */
export const ModerationNavCard = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await api.auth.getUser();
        if (!user) return;
        const meta = await getCurrentUserMeta(user.id);
        if (!alive) return;
        setVisible(meta.roles.some((r) => r === "helper" || r === "moderator" || r === "admin"));
      } catch {
        // Signed out or offline — stay hidden.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
      <PrefetchLink
        to="/moderation"
        className="flex w-full items-center gap-2.5 px-3 py-3 text-sm font-medium transition-colors hover:bg-muted/60 sm:px-4"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
          <Gavel className="h-4 w-4 text-primary" />
        </span>
        Модерация
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
      </PrefetchLink>
    </div>
  );
};
