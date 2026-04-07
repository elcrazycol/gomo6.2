import { renderLexicalContent } from "@/utils/lexicalContent";

interface RichContentRendererProps {
  contentJson?: unknown;
}

/** Matches GomoRichEditor read typography (text-sm / sm:text-base, links, inline marks). */
const richDisplayClassName =
  "gomo-rich-content text-sm sm:text-base break-words leading-6 sm:leading-7 text-foreground " +
  "[&_strong]:font-bold [&_em]:italic [&_u]:underline [&_s]:line-through";

export const RichContentRenderer = ({ contentJson }: RichContentRendererProps) => {
  return (
    <div className={richDisplayClassName}>{renderLexicalContent(contentJson)}</div>
  );
};
