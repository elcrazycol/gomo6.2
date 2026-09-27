import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PentagramLoader } from "@/components/PentagramLoader";
import { SectionIcon } from "@/components/topic/sectionIcons";
import type { SectionWithSubsections } from "@/hooks/useThreadSections";
import { useSidebarTabsStore } from "@/stores/sidebarTabsStore";

interface AddTabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionWithSubsections[];
  loading?: boolean;
}

/**
 * Panel for creating a custom sidebar tab: pick a раздел / подраздел, name the
 * tab, and optionally make it open instead of the feed on the main page.
 */
export const AddTabDialog = ({ open, onOpenChange, sections, loading }: AddTabDialogProps) => {
  const addTab = useSidebarTabsStore((state) => state.addTab);

  const [sectionSlug, setSectionSlug] = useState<string | null>(null);
  const [subsectionSlug, setSubsectionSlug] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [isHome, setIsHome] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Fresh state each time the panel opens.
  useEffect(() => {
    if (!open) return;
    setSectionSlug(null);
    setSubsectionSlug(null);
    setLabel("");
    setLabelTouched(false);
    setIsHome(false);
    setExpanded(null);
  }, [open]);

  const pickSection = (section: SectionWithSubsections) => {
    setSectionSlug(section.slug);
    setSubsectionSlug(null);
    if (!labelTouched) setLabel(section.name);
    setExpanded((prev) => (prev === section.slug ? null : section.slug));
  };

  const pickSubsection = (section: SectionWithSubsections, slug: string, name: string) => {
    setSectionSlug(section.slug);
    setSubsectionSlug(slug);
    if (!labelTouched) setLabel(name);
  };

  const handleAdd = () => {
    if (!sectionSlug) return;
    addTab({
      sectionSlug,
      subsectionSlug,
      label: label.trim() || sectionSlug,
      isHome,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая вкладка</DialogTitle>
          <DialogDescription>
            Выбери раздел или подраздел — вкладка появится в сайдбаре.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium">Раздел</div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border/70 p-1.5">
              {loading && sections.length === 0 ? (
                <div className="flex justify-center py-6">
                  <PentagramLoader size="sm" />
                </div>
              ) : (
                sections.map((section) => {
                  const sectionSelected = sectionSlug === section.slug && !subsectionSlug;
                  const isOpen = expanded === section.slug;
                  const hasSubsections = section.subsections.length > 0;
                  return (
                    <div key={section.id}>
                      <button
                        type="button"
                        onClick={() => pickSection(section)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          sectionSelected
                            ? "bg-primary/10 font-semibold text-primary"
                            : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        <SectionIcon name={section.icon} className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        <span className="min-w-0 flex-1 truncate text-left">{section.name}</span>
                        {sectionSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        {hasSubsections && (
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </button>
                      {isOpen && hasSubsections && (
                        <div className="mb-1 ml-[22px] border-l border-border/60 pl-2">
                          {section.subsections.map((subsection) => {
                            const subSelected =
                              sectionSlug === section.slug && subsectionSlug === subsection.slug;
                            return (
                              <button
                                key={subsection.id}
                                type="button"
                                onClick={() => pickSubsection(section, subsection.slug, subsection.name)}
                                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                                  subSelected
                                    ? "bg-primary/10 font-semibold text-primary"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate text-left">{subsection.name}</span>
                                {subSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="tab-label">
              Название вкладки
            </label>
            <Input
              id="tab-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelTouched(true);
              }}
              placeholder="Например, «Игры»"
              maxLength={40}
              className="mt-2"
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Открывать вместо feed</div>
              <p className="text-xs text-muted-foreground">
                Эта вкладка будет открываться на главной странице вместо ленты
              </p>
            </div>
            <Switch checked={isHome} onCheckedChange={setIsHome} aria-label="Открывать вместо feed" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleAdd} disabled={!sectionSlug}>
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
