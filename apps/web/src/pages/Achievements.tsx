import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Trophy } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AwardCard, TrophyCard } from "@/components/TrophyCard";
import { useTrophies } from "@/hooks/useTrophies";
import { getCached } from "@/integrations/api/queryCache";

/**
 * Трофейный зал: only the trophies the user has actually earned — auto milestone
 * levels and hand-granted awards — ordered rarest first. Nothing locked is shown
 * (no silhouettes, no progress), and hand-granted awards get their own block with
 * the author, reason and date, because that provenance is the point.
 */
export default function Achievements() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const { trophies, loading } = useTrophies(userId);
  const [profile, setProfile] = useState<{ username: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCached<{ username: string } | null>(
      `achievements-page:profile:${userId}`,
      async () => {
        const res = await fetch(`/api/v1/profiles?id=eq.${userId}&select=id,username`);
        const json = await res.json();
        return json.data?.[0] ?? null;
      },
      { ttlMs: 60_000 },
    ).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const milestones = useMemo(() => trophies.filter((x) => x.kind === "milestone"), [trophies]);
  const awards = useMemo(() => trophies.filter((x) => x.kind === "award"), [trophies]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4">
      <header className="space-y-3">
        <Link
          to={`/profile/${userId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {profile
            ? t("achievements.backToProfile", { username: profile.username })
            : t("achievements.back")}
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {t("achievements.title")}
              {profile && ` — ${profile.username}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("achievements.count", { count: trophies.length })}
            </p>
          </div>
        </div>
      </header>

      {trophies.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{t("achievements.noTrophies")}</p>
      ) : (
        <>
          {milestones.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("achievements.milestonesSection")} ({milestones.length})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {milestones.map((trophy) => (
                  <TrophyCard key={trophy.key} trophy={trophy} />
                ))}
              </div>
            </section>
          )}

          {awards.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("achievements.manualSection")} ({awards.length})
              </h2>
              <div className="space-y-3">
                {awards.map((trophy) => (
                  <AwardCard key={trophy.key} trophy={trophy} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
