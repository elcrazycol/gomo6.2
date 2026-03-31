import { useState } from "react";

export function CensorBlur({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span
      className={`CensorSpoilerRoot ${revealed ? "revealed" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={revealed}
      onPointerDownCapture={(event) => {
        if (!revealed) {
          event.preventDefault();
          event.stopPropagation();
          setRevealed(true);
        }
      }}
      onClick={() => {
        if (!revealed) {
          setRevealed(true);
        }
      }}
      onKeyDown={(event) => {
        if (revealed) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setRevealed(true);
        }
      }}
      title={revealed ? "" : "Нажмите, чтобы раскрыть"}
      style={{ cursor: revealed ? "default" : "pointer" }}
    >
      <span
        className={`CensorSpoiler ${revealed ? "revealed" : ""}`}
        style={{
          filter: revealed ? "blur(0px)" : "blur(5px)",
          WebkitFilter: revealed ? "blur(0px)" : "blur(5px)",
          userSelect: revealed ? "text" : "none",
          WebkitUserSelect: revealed ? "text" : "none",
          pointerEvents: revealed ? "auto" : "none",
          background: revealed ? "transparent" : "hsl(var(--muted) / 0.65)",
          borderColor: revealed ? "transparent" : "hsl(var(--border) / 0.75)",
          padding: revealed ? "0" : "0.08rem 0.35rem",
        }}
      >
        {children}
      </span>
    </span>
  );
}
