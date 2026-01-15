import { useMemo, useState } from "react";

interface BbCodeSpoilerProps {
  title?: string | null;
  children: React.ReactNode;
}

export function BbCodeSpoiler({ title, children }: BbCodeSpoilerProps) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => {
    const t = (title ?? "").trim();
    return t.length > 0 ? t : "Spoiler";
  }, [title]);

  return (
    <div className={`bbCodeSpoilerContainer ToggleTriggerAnchor ${open ? "open" : ""}`} style={{ textAlign: "left" }}>
      <button
        type="button"
        className={`bbCodeSpoilerButton button ToggleTrigger Tooltip JsOnly ${open ? "opened open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Click to reveal or hide spoiler"
      >
        <span className="inline-flex items-center gap-2">
          {title && title.trim().length > 0 ? (
            <span className="SpoilerTitle">{label}</span>
          ) : (
            <span>{label}</span>
          )}
          <span className={`arrowWidget inline-block transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>
      <div className="SpoilerTarget bbCodeSpoilerText" style={{ display: open ? "block" : "none", opacity: open ? 1 : 0 }}>
        {children}
      </div>
    </div>
  );
}

