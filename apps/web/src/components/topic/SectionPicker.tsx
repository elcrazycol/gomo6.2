// Раздел picker for creating a topic. Two steps: pick a раздел; if it has
// подразделы they slide in and picking one is optional (there is always a
// "Continue without подраздел" path). A раздел without подразделы advances
// straight away.

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { SectionIcon } from "@/components/topic/sectionIcons";
import type { SectionWithSubsections, ThreadSection, ThreadSubsection } from "@/hooks/useThreadSections";

interface SectionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionWithSubsections[];
  loading: boolean;
  /** Currently chosen placement, if the user is changing it. */
  currentSectionId?: string;
  currentSubsectionId?: string;
  onSelect: (section: ThreadSection, subsection: ThreadSubsection | null) => void;
}

export const SectionPicker = ({
  open,
  onOpenChange,
  sections,
  loading,
  currentSectionId,
  currentSubsectionId,
  onSelect,
}: SectionPickerProps) => {
  const [activeId, setActiveId] = useState<string | null>(currentSectionId ?? null);

  // Reopen at the current placement when changing, otherwise at the root list.
  useEffect(() => {
    if (open) setActiveId(currentSectionId ?? null);
  }, [open, currentSectionId]);

  const active = sections.find((s) => s.id === activeId) ?? null;

  const chooseSection = (section: SectionWithSubsections) => {
    if (section.subsections.length === 0) {
      onSelect(section, null);
      onOpenChange(false);
      return;
    }
    setActiveId(section.id);
  };

  const chooseSubsection = (section: ThreadSection, subsection: ThreadSubsection | null) => {
    onSelect(section, subsection);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden z-[80]" overlayClassName="z-[75]">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            {active && (
              <button
                type="button"
                aria-label="Назад к разделам"
                onClick={() => setActiveId(null)}
                className="rounded-full p-1 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {active ? active.name : "Выберите раздел"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <PentagramLoader size="md" />
            </div>
          ) : !active ? (
            <div className="grid gap-2">
              {sections.map((section) => {
                const isCurrent = section.id === currentSectionId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => chooseSection(section)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-primary/5 ${
                      isCurrent ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-primary">
                      <SectionIcon name={section.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        {section.name}
                        {section.is_nsfw && (
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            18+
                          </span>
                        )}
                      </span>
                      {section.description && (
                        <span className="block truncate text-xs text-muted-foreground">{section.description}</span>
                      )}
                    </span>
                    {section.subsections.length > 0 ? (
                      <span className="text-xs text-muted-foreground">{section.subsections.length} подразд.</span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
              {sections.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Разделы пока не настроены</p>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              {active.subsections.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => chooseSubsection(active, sub)}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-primary/5 ${
                    sub.id === currentSubsectionId ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{sub.name}</span>
                    {sub.description && (
                      <span className="block truncate text-xs text-muted-foreground">{sub.description}</span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              <Button
                type="button"
                variant="outline"
                className="mt-1"
                onClick={() => chooseSubsection(active, null)}
              >
                Продолжить без подраздела
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
