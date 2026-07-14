import { renderLexicalContent } from "@/utils/lexicalContent";
import { isProsemirrorJson, lexicalToProsemirror } from "@/utils/contentConverter";
import { ProseMirrorRenderer } from "@/components/ProseMirrorRenderer";

interface RichContentRendererProps {
  contentJson?: unknown;
}

const richDisplayClassName =
  "gomo-rich-content text-sm sm:text-base break-words leading-6 sm:leading-7 text-foreground " +
  "[&_strong]:font-bold [&_em]:italic [&_u]:underline [&_s]:line-through";

export const RichContentRenderer = ({ contentJson }: RichContentRendererProps) => {
  if (isProsemirrorJson(contentJson)) {
    return (
      <div className={richDisplayClassName}>
        <ProseMirrorRenderer json={contentJson as Parameters<typeof ProseMirrorRenderer>[0]["json"]} />
      </div>
    );
  }

  const prosemirror = lexicalToProsemirror(contentJson);
  if (prosemirror) {
    return (
      <div className={richDisplayClassName}>
        <ProseMirrorRenderer json={prosemirror} />
      </div>
    );
  }

  return (
    <div className={richDisplayClassName}>{renderLexicalContent(contentJson)}</div>
  );
};
