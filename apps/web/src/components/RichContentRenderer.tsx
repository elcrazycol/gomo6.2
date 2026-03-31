import { renderLexicalContent } from "@/utils/lexicalContent";

interface RichContentRendererProps {
  contentJson?: unknown;
}

export const RichContentRenderer = ({ contentJson }: RichContentRendererProps) => {
  return <>{renderLexicalContent(contentJson)}</>;
};
