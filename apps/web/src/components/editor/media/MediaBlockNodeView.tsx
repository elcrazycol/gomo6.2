// Editor NodeView for a media block: selection ring and a bottom toolbar
// (placement, size, link, caption/alt, replace, edit, delete). The media itself
// is the shared MediaBlockContent so the editor and the read view render
// identically (true WYSIWYG).
//
// Dragging uses pointer events (see mediaDrag.ts): the whole media + the grip
// are drag sources, the cursor becomes a grabbing hand and a custom caret shows
// where the media will land. Resize handles were removed deliberately.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlignLeft,
  AlignRight,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Pencil,
  Pilcrow,
  Replace,
  Star,
  Trash2,
  Type,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { MediaBlockContent } from "./MediaBlockView";
import { mediaFigureLayout } from "./mediaLayout";
import { useMediaView } from "./mediaViewContext";
import { useMediaEditor } from "./mediaEditorContext";
import { startMediaDrag } from "./mediaDrag";
import {
  COVER_PLACEMENTS,
  mediaShape,
  naturalWidthPercent,
  toMediaBlockAttrs,
  type CoverPlacement,
  type MediaAlign,
} from "./mediaSchema";

const COVER_PLACEMENT_LABELS: Record<CoverPlacement, string> = {
  top: "Сверху",
  bottom: "Снизу",
  inline: "На месте (в тексте)",
};

const PLACEMENT_OPTIONS: Array<{ value: MediaAlign; label: string; Icon: typeof AlignLeft }> = [
  { value: "inline", label: "В строке", Icon: Pilcrow },
  { value: "left", label: "Слева (обтекание)", Icon: AlignLeft },
  { value: "right", label: "Справа (обтекание)", Icon: AlignRight },
  { value: "full", label: "На всю ширину", Icon: Maximize2 },
];

export const MediaBlockNodeView = ({ node, editor, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) => {
  const attrs = toMediaBlockAttrs(node.attrs);
  const { attachments } = useMediaView();
  const editorContext = useMediaEditor();
  const rootRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkDraft, setLinkDraft] = useState(attrs.href ?? "");
  const [captionDraft, setCaptionDraft] = useState(attrs.caption);
  const [altDraft, setAltDraft] = useState(attrs.alt);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  const attachment = attachments.find((att) => att.id === attrs.attachmentId) ?? null;
  const layout = mediaFigureLayout(attrs.align, attrs.width);
  const isCover = Boolean(editorContext?.setCover) && editorContext?.coverId === attrs.attachmentId;
  const canSetCover = Boolean(editorContext?.setCover) && attachment?.type === "image";
  const coverPlacements = isCover ? (editorContext?.coverPlacements ?? []) : [];

  const toggleCoverPlacement = (placement: CoverPlacement, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...coverPlacements, placement]))
      : coverPlacements.filter((item) => item !== placement);
    if (next.length === 0) editorContext?.setCover?.(null, []);
    else editorContext?.setCover?.(attrs.attachmentId, next);
  };

  const selectNode = () => {
    const pos = getPos();
    if (typeof pos === "number") editor.chain().setNodeSelection(pos).run();
  };

  const applyNaturalWidth = () => {
    if (!attachment) return;
    const containerWidth = rootRef.current?.parentElement?.clientWidth ?? 640;
    updateAttributes({ width: naturalWidthPercent(attachment, containerWidth) });
  };

  const openDetails = (open: boolean) => {
    if (open) {
      setLinkDraft(attrs.href ?? "");
      setCaptionDraft(attrs.caption);
      setAltDraft(attrs.alt);
    }
    setDetailsOpen(open);
  };

  const applyDetails = () => {
    updateAttributes({ href: linkDraft.trim() || null, caption: captionDraft, alt: altDraft });
    setDetailsOpen(false);
  };

  // ── Drag (pointer) ────────────────────────────────────────────────────────
  const startDragAt = (pos: number, clientX: number, clientY: number) => {
    selectNode();
    startMediaDrag({
      editor,
      sourcePos: pos,
      clientX,
      clientY,
      onStart: () => setDragging(true),
      onEnd: () => setDragging(false),
    });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    // Touch: a plain swipe must keep scrolling the page, so the drag only
    // starts after a long-press (and is cancelled if the finger moves first).
    if (event.pointerType === "touch") {
      const pos = getPos();
      if (typeof pos !== "number") return;
      const startX = event.clientX;
      const startY = event.clientY;
      const timer = window.setTimeout(() => {
        cleanup();
        startDragAt(pos, startX, startY);
      }, 250);
      function cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
      }
      function onMove(moveEvent: PointerEvent) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 12) cleanup();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
      return;
    }

    if (event.button !== 0) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    // Suppress the browser's native drag / text selection: we drive it ourselves.
    event.preventDefault();
    event.stopPropagation();
    startDragAt(pos, event.clientX, event.clientY);
  };

  const handleReplaceFile = async (file: File | undefined) => {
    if (!file || !editorContext) return;
    const replaced = await editorContext.replaceAttachment(attrs.attachmentId, file);
    if (replaced) {
      const containerWidth = rootRef.current?.parentElement?.clientWidth ?? 640;
      updateAttributes({
        attachmentId: replaced.id,
        alt: replaced.name || attrs.alt,
        width: naturalWidthPercent(replaced, containerWidth),
      });
    }
  };

  const toolbarButtonClass = "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";
  // Hidden until the node is selected or hovered — but stay visible while any
  // of the toolbar's own panels is open, otherwise it vanishes mid-interaction
  // (the popover content lives in a portal, outside the hovered group).
  const anyPanelOpen = placementOpen || sizeOpen || detailsOpen;
  const toolbarVisibility =
    selected || anyPanelOpen
      ? "opacity-100"
      : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100";

  return (
    <NodeViewWrapper
      as="div"
      ref={rootRef}
      data-media-block="true"
      data-shape={mediaShape(attrs.aspect)}
      data-selected={selected ? "true" : "false"}
      data-align={attrs.align}
      contentEditable={false}
      className={`group ${layout.className} ${selected ? "ring-2 ring-primary/60" : "hover:ring-1 hover:ring-border"}`}
      style={layout.style}
      onClick={selectNode}
    >
      {/* The media is the drag source: grab the photo itself to move it. The
          cursor is a grab hand (grabbing while dragging), not the read-view
          zoom-in magnifier; native image drag is disabled. */}
      <div
        onPointerDown={beginDrag}
        onDragStart={(event) => event.preventDefault()}
        className={`select-none [-webkit-touch-callout:none] ${
          dragging
            ? "cursor-grabbing [&_*]:cursor-grabbing"
            : "cursor-grab [&_button]:cursor-grab [&_img]:cursor-grab [&_video]:cursor-grab"
        }`}
      >
        <MediaBlockContent attrs={attrs} editable />
      </div>

      {!attachment && (
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-1 text-[11px] text-muted-foreground">
          <ImageIcon className="h-3 w-3" /> Нет файла
        </span>
      )}

      {/* Toolbar — pinned to the bottom INSIDE the media box, horizontally
          centred over the media and only as wide as its own content (not the
          media width), so it never stretches the full image. */}
      <div
        data-media-toolbar="true"
        onClick={(event) => event.stopPropagation()}
        className={`absolute bottom-1 left-1/2 z-30 flex w-max max-w-[90vw] -translate-x-1/2 flex-nowrap items-center gap-0.5 overflow-x-auto rounded-lg border border-border/70 bg-background/95 p-1 shadow-sm transition-opacity ${toolbarVisibility}`}
      >
        {/* Placement — one category button; the options slide up into view. */}
        <Popover open={placementOpen} onOpenChange={setPlacementOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Размещение"
              className={`${toolbarButtonClass} ${attrs.align !== "inline" ? "text-primary" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Pilcrow className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-56 p-1" style={{ zIndex: 70 }} onClick={(event) => event.stopPropagation()}>
            {PLACEMENT_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  updateAttributes({ align: value });
                  setPlacementOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                  attrs.align === value ? "bg-primary/15 text-primary" : "text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Size — one category button showing the current width. */}
        <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Размер"
              className="h-7 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {attrs.width}%
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-56 space-y-3 p-3" style={{ zIndex: 70 }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Размер</span>
              <span className="tabular-nums text-foreground">{attrs.width}%</span>
            </div>
            <Slider
              min={10}
              max={100}
              step={1}
              value={[attrs.width]}
              onValueChange={(value) => updateAttributes({ width: value[0] })}
              aria-label="Ширина медиа"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-[11px] text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyNaturalWidth()}
            >
              Авто (по размеру медиа)
            </Button>
          </PopoverContent>
        </Popover>

        <span className="mx-0.5 h-4 w-px bg-border" />

        {/* Text / link / alt details. */}
        <Popover open={detailsOpen} onOpenChange={openDetails}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Ссылка, подпись, alt"
              className={`${toolbarButtonClass} ${attrs.href ? "text-primary" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Type className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 space-y-3" style={{ zIndex: 70 }} onClick={(event) => event.stopPropagation()}>
            <label className="block space-y-1" htmlFor="media-link-input">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" /> Ссылка
              </span>
              <Input id="media-link-input" value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="https://…" />
            </label>
            <label className="block space-y-1" htmlFor="media-caption-input">
              <span className="text-xs font-medium text-muted-foreground">Подпись</span>
              <Input id="media-caption-input" value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} placeholder="Подпись к медиа" />
            </label>
            <label className="block space-y-1" htmlFor="media-alt-input">
              <span className="text-xs font-medium text-muted-foreground">Alt (для доступности)</span>
              <Input id="media-alt-input" value={altDraft} onChange={(event) => setAltDraft(event.target.value)} placeholder="Описание" />
            </label>
            <Button type="button" size="sm" className="w-full" onClick={applyDetails}>
              Применить
            </Button>
          </PopoverContent>
        </Popover>

        {editorContext && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Заменить файл"
            className={toolbarButtonClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <Replace className="h-4 w-4" />
          </Button>
        )}

        {editorContext?.openImageEditor && attachment?.type === "image" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Редактировать изображение"
            className={toolbarButtonClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editorContext.openImageEditor?.(attrs.attachmentId)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}

        {canSetCover && (
          <Popover open={coverOpen} onOpenChange={setCoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Обложка поста"
                aria-pressed={isCover}
                className={`${toolbarButtonClass} ${isCover ? "text-primary" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
              >
                <Star className={`h-4 w-4 ${isCover ? "fill-current" : ""}`} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-60 space-y-2 p-3"
              style={{ zIndex: 70 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="text-xs font-medium text-muted-foreground">Обложка поста</div>
              {COVER_PLACEMENTS.map((placement) => (
                <label key={placement} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={coverPlacements.includes(placement)}
                    onCheckedChange={(checked) => toggleCoverPlacement(placement, checked === true)}
                  />
                  {COVER_PLACEMENT_LABELS[placement]}
                </label>
              ))}
              <p className="text-[11px] leading-4 text-muted-foreground">
                Отметьте, где показывать фото. Обложка одна на пост.
              </p>
            </PopoverContent>
          </Popover>
        )}

        <span className="mx-0.5 h-4 w-px bg-border" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Удалить"
          className={`${toolbarButtonClass} text-destructive hover:text-destructive`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        data-testid="media-replace-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handleReplaceFile(file);
        }}
      />
    </NodeViewWrapper>
  );
};
