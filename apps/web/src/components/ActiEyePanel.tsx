import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ActiEyeSummary } from "./ActiEye";
import { ActiEyeStreakRoad } from "./ActiEyeStreakRoad";

interface ActiEyePanelProps {
  summary: ActiEyeSummary | null;
  onClose: () => void;
}

/**
 * Minimalistic activity overlay: at the top — the long horizontal "road" of
 * the last 30 days with the current visit streak; below — a placeholder for
 * future content.
 */
export function ActiEyePanel({ summary, onClose }: ActiEyePanelProps) {
  const { t, i18n } = useTranslation();
  const streak = summary?.current_streak ?? 0;
  const best = summary?.best_streak ?? 0;
  const days = summary?.days ?? [];
  // Левая граница дороги — дата регистрации (первый день окна).
  const registeredLabel =
    days.length > 0 ? new Date(`${days[0].date}T00:00:00`).toLocaleDateString(i18n.language === "en" ? "en-US" : "ru-RU") : null;

  // Закрытие по Escape — как у остальных диалогов.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("actieye.activity")}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold">{t("actieye.activity")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {/* Серия заходов — «дорога» со дня регистрации */}
          <section>
            <div className="flex items-end gap-2.5">
              <span className="text-4xl font-extrabold leading-none">{streak}</span>
              <div className="pb-0.5">
                <p className="text-sm font-medium leading-tight">{t("actieye.daysStreak")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("actieye.bestStreak")}: {best}
                </p>
              </div>
            </div>

            <div className="mt-2 -mx-2">
              <ActiEyeStreakRoad days={days} />
            </div>
            {registeredLabel && (
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>{registeredLabel}</span>
                <span>{t("actieye.today")}</span>
              </div>
            )}
          </section>

          <div className="h-px bg-border" />

          {/* Заглушка под будущий контент */}
          <section className="py-4 text-center">
            <p className="text-sm text-muted-foreground">{t("actieye.placeholder")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
