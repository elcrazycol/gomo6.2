// Editor NodeView for a media gallery: a layout switcher (grid 2 / grid 3 /
// mosaic / carousel) and a delete action, floating over the group. The media
// children render through NodeViewContent, so each media keeps its own toolbar.

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Columns3, GalleryHorizontalEnd, Grid3x3, LayoutGrid, LayoutList, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ungroupMediaGroup } from "./mediaCommands";
import { mediaGroupLayoutClass } from "./mediaLayout";
import { toMediaGroupAttrs, type MediaGroupLayout } from "./mediaSchema";

const LAYOUTS: Array<{ value: MediaGroupLayout; label: string; Icon: typeof LayoutGrid }> = [
  { value: "grid", label: "Сетка 2", Icon: LayoutGrid },
  { value: "grid3", label: "Сетка 3", Icon: Grid3x3 },
  { value: "mosaic", label: "Мозаика", Icon: Columns3 },
  { value: "carousel", label: "Карусель", Icon: GalleryHorizontalEnd },
];

export const MediaGroupNodeView = ({ node, editor, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) => {
  const attrs = toMediaGroupAttrs(node.attrs);
  const toolbarVisibility = selected
    ? "opacity-100"
    : "pointer-events-none opacity-0 group-hover/gallery:pointer-events-auto group-hover/gallery:opacity-100";

  const handleUngroup = () => {
    const pos = getPos();
    if (typeof pos === "number") ungroupMediaGroup(editor, pos);
  };

  return (
    <NodeViewWrapper
      as="div"
      data-media-group="true"
      data-selected={selected ? "true" : "false"}
      className="group/gallery relative my-2"
    >
      <NodeViewContent as="div" className={mediaGroupLayoutClass(attrs.layout)} />

      <div
        contentEditable={false}
        onClick={(event) => event.stopPropagation()}
        className={`absolute right-2 top-2 z-30 flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/95 p-1 shadow-sm transition-opacity ${toolbarVisibility}`}
      >
        {LAYOUTS.map(({ value, label, Icon }) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="icon"
            title={label}
            aria-pressed={attrs.layout === value}
            className={`h-7 w-7 p-0 text-muted-foreground hover:text-foreground ${
              attrs.layout === value ? "bg-primary/15 text-primary" : ""
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => updateAttributes({ layout: value })}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Разгруппировать"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleUngroup}
        >
          <LayoutList className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Удалить галерею"
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
