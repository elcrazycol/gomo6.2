import { useState } from "react";

export const SpoilerText = ({ content }: { content: string }) => {
  const [revealed, setRevealed] = useState(false);
  
  if (revealed) {
    return <span className="bg-transparent">{content}</span>;
  }
  
  return (
    <span
      className="bg-foreground text-foreground cursor-pointer select-none"
      onClick={() => setRevealed(true)}
      title="Нажмите, чтобы раскрыть"
    >
      {content.split('').map(() => '█').join('')}
    </span>
  );
};