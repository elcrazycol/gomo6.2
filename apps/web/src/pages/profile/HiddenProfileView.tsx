import { useTranslation } from "react-i18next";
import { UserRound } from "lucide-react";
import type { Profile } from "./types";

/**
 * The profile a viewer sees when its owner blocked them.
 *
 * Everything the owner ever put on the page is gone: avatar, background, bio,
 * counters, pinned threads, posts, gifts, achievements. What remains is the
 * bare identity a chat row already knows (name + username), the placeholder
 * avatar and «был(а) давно» — the same phrase used for accounts that have been
 * gone for a long time. Nothing on this screen hints at a block.
 */
export function HiddenProfileView({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const name = profile.display_name || profile.username;

  return (
    <section className="surface-panel mx-auto mt-6 max-w-xl rounded-2xl border border-border/60 p-6 shadow-sm sm:mt-10 sm:p-8">
      <div className="flex items-center gap-4">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <UserRound className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight">{name}</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            @{profile.username}
            <span className="px-1.5">·</span>
            {t("time.wasOnlineLongAgo")}
          </p>
        </div>
      </div>

      <div className="mt-8 border-t border-border/60 pt-10 text-center">
        <p className="text-base font-semibold">{t("profile.emptyProfileTitle")}</p>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">
          {t("profile.emptyProfileHint")}
        </p>
      </div>
    </section>
  );
}
