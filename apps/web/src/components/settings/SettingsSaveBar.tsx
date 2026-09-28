import { useTranslation } from "react-i18next";
import { Check, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sticky save bar for the sections that write to the database (privacy,
 * security-adjacent settings). The appearance section applies instantly and
 * needs no bar — that is the one intentional split in the save model.
 *
 * It always renders: when there is nothing to save it becomes a quiet "all
 * saved" line, so the page never shifts as the dirty state flips.
 */

interface SettingsSaveBarProps {
  dirty: boolean;
  saving?: boolean;
  changedCount?: number;
  onSave: () => void;
  onReset?: () => void;
  className?: string;
}

export const SettingsSaveBar = ({
  dirty,
  saving = false,
  changedCount = 0,
  onSave,
  onReset,
  className,
}: SettingsSaveBarProps) => {
  const { t } = useTranslation();

  return (
    <div className={cn("sticky bottom-3 z-[80]", className)}>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-2xl border p-3 backdrop-blur-xl transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-4",
          "shadow-[0_1px_2px_oklch(var(--foreground)/0.04),0_18px_44px_-26px_oklch(var(--foreground)/0.35)]",
          dirty ? "border-primary/40 bg-card/90" : "border-border/60 bg-card/75",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5 text-sm" role="status" aria-live="polite">
          {dirty ? (
            <>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="font-medium">{t("settings2.unsavedChanges", { count: changedCount })}</span>
            </>
          ) : (
            <>
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="text-muted-foreground">{t("settings2.allSaved")}</span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onReset && (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              disabled={saving}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t("settings2.resetAction")}</span>
            </Button>
          )}
          <Button type="button" onClick={onSave} disabled={!dirty || saving} className="min-w-[132px] gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t("settings2.saving") : t("settings2.saveAction")}
          </Button>
        </div>
      </div>
    </div>
  );
};
