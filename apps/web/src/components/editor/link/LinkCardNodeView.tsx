import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkCardView } from "./LinkCardView";
import { toLinkCardAttrs } from "./linkCardSchema";

export const LinkCardNodeView = ({ node, deleteNode, selected }: NodeViewProps) => {
  const attrs = toLinkCardAttrs(node.attrs);
  const toolbarVisibility = selected
    ? "opacity-100"
    : "pointer-events-none opacity-0 group-hover/linkcard:pointer-events-auto group-hover/linkcard:opacity-100";

  return (
    <NodeViewWrapper
      as="div"
      data-link-card="true"
      data-selected={selected ? "true" : "false"}
      contentEditable={false}
      className="group/linkcard relative my-2"
    >
      <LinkCardView attrs={attrs} editable />

      <div
        data-link-card-toolbar="true"
        className={`absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/95 p-1 shadow-sm transition-opacity ${toolbarVisibility}`}
      >
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon"
          title="Открыть ссылку"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
        >
          <a href={attrs.url || undefined} target="_blank" rel="noopener noreferrer nofollow ugc">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Удалить карточку"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </NodeViewWrapper>
  );
};
