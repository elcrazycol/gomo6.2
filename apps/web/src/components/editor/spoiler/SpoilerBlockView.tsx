// Read-view spoiler block: the label header is always visible; the content is
// collapsed to zero height and animates open (grid-rows 0fr → 1fr) when the
// reader reveals it.

import { useState, type ReactNode } from "react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";

import { spoilerLabel } from "./spoilerSchema";
import "./SpoilerBlock.css";

export const SpoilerBlockView = ({ label, children }: { label: unknown; children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const text = spoilerLabel(label);

  return (
    <div
      data-spoiler-block="true"
      data-open={open ? "true" : "false"}
      className="spoiler-block my-2 overflow-hidden rounded-xl border border-border/70 bg-card/60 transition-shadow duration-200 ease-out hover:shadow-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
      >
        {open ? (
          <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate">{text}</span>
        <span className="ml-2 shrink-0 text-xs font-normal text-muted-foreground">
          {open ? "Скрыть" : "Показать"}
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Height animation via grid rows: the browser resolves 0fr → 1fr, so it
          is smooth and needs no JS measurement. */}
      <div
        data-spoiler-reveal="true"
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div
          aria-hidden={!open}
          className={`min-h-0 overflow-hidden transition-[opacity,transform,visibility] duration-300 ease-out motion-reduce:transition-none ${
            open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
          }`}
        >
          <div className="spoiler-block__body px-3 pb-3 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
};
