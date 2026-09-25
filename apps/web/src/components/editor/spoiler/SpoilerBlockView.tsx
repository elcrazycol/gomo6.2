// Read-view spoiler block: the label header is always visible; the content is
// blurred and inert until the reader reveals it.

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
      className="spoiler-block my-2 overflow-hidden rounded-xl border border-border/70 bg-card/60"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
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
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        aria-hidden={!open}
        className={`spoiler-block__body px-3 pb-3 pt-1${open ? "" : " spoiler-block__body--hidden"}`}
      >
        {children}
      </div>
    </div>
  );
};
