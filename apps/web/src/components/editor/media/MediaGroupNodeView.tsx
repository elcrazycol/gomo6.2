// Editor NodeView for a media gallery: a layout switcher (grid 2 / grid 3 /
// mosaic / carousel) and a delete action, floating over the group. The media
// children render through NodeViewContent, so each media keeps its own toolbar.

import { useEffect, useRef } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { GalleryHorizontalEnd, Grid3x3, LayoutDashboard, LayoutGrid, LayoutList, Rows3, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ungroupMediaGroup } from "./mediaCommands";
import { computeJustifiedSizes } from "./justifiedLayout";
import { mediaGroupLayoutClass } from "./mediaLayout";
import { toMediaGroupAttrs, type MediaGroupLayout } from "./mediaSchema";

const LAYOUTS: Array<{ value: MediaGroupLayout; label: string; Icon: typeof LayoutGrid }> = [
  { value: "smart", label: "Умная мозаика", Icon: LayoutDashboard },
  { value: "justified", label: "Ровные ряды", Icon: Rows3 },
  { value: "grid", label: "Сетка 2", Icon: LayoutGrid },
  { value: "grid3", label: "Сетка 3", Icon: Grid3x3 },
  { value: "carousel", label: "Карусель", Icon: GalleryHorizontalEnd },
];
// "mosaic" stays supported for existing galleries but is no longer offered:
// smart (cropped collage) and justified (no crop) cover it.

export const MediaGroupNodeView = ({ node, editor, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) => {
  const attrs = toMediaGroupAttrs(node.attrs);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const toolbarVisibility = selected
    ? "opacity-100"
    : "pointer-events-none opacity-0 group-hover/gallery:pointer-events-auto group-hover/gallery:opacity-100";

  const handleUngroup = () => {
    const pos = getPos();
    if (typeof pos === "number") ungroupMediaGroup(editor, pos);
  };

  // "Justified" layout sizes each media imperatively so rows have equal height
  // and media are not cropped (the read view uses JustifiedGallery instead).
  useEffect(() => {
    const root = groupRef.current;
    if (!root) return;
    const container = root.querySelector<HTMLElement>(".media-group");
    if (!container) return;
    const getItems = () => {
      const inner = container.querySelector<HTMLElement>("[data-node-view-content-react]");
      return inner ? (Array.from(inner.children) as HTMLElement[]) : (Array.from(container.children) as HTMLElement[]);
    };
    const clear = () => {
      getItems().forEach((el) => {
        el.style.width = "";
        el.style.height = "";
        el.style.flex = "";
      });
    };

    if (attrs.layout !== "justified") {
      clear();
      return;
    }

    const aspects: number[] = [];
    node.content.forEach((child) => {
      const aspect = Number(child.attrs.aspect);
      aspects.push(Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
    });

    const apply = () => {
      const width = container.clientWidth;
      if (!width) return;
      const sizes = computeJustifiedSizes(aspects, width, { gap: 4 });
      getItems().forEach((el, index) => {
        const size = sizes[index];
        if (!size) return;
        el.style.width = `${size.width}px`;
        el.style.height = `${size.height}px`;
        el.style.flex = "0 0 auto";
      });
    };

    apply();
    if (typeof ResizeObserver === "undefined") {
      return clear;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [attrs.layout, node]);

  return (
    <NodeViewWrapper
      as="div"
      ref={groupRef}
      data-media-group="true"
      data-selected={selected ? "true" : "false"}
      className="group/gallery relative"
    >
      <NodeViewContent as="div" className={mediaGroupLayoutClass(attrs.layout)} />

      <div
        data-media-toolbar="true"
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
