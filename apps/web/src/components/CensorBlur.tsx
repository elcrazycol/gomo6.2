import { useState } from "react";

export function CensorBlur({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span
      className={`CensorSpoiler ${revealed ? "revealed" : ""}`}
      onClick={() => setRevealed(true)}
      title={revealed ? "" : "Нажмите, чтобы раскрыть"}
    >
      {children}
    </span>
  );
}

