// Editor NodeView for a spoiler block: a label header with a show/hide toggle,
// a label editor and a delete action. The content is editable while revealed and
// blurred/inert while collapsed. Starts revealed so typing after insertion works.

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clampSpoilerLabel, spoilerLabel } from "./spoilerSchema";
import "./SpoilerBlock.css";

export const SpoilerBlockNodeView = ({ node, updateAttributes, deleteNode, selected }: NodeViewProps) => {
  const [open, setOpen] = useState(true);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(() => clampSpoilerLabel(node.attrs.label));
  const label = spoilerLabel(node.attrs.label);

  const openLabelEditor = (nextOpen: boolean) => {
    if (nextOpen) setLabelDraft(clampSpoilerLabel(node.attrs.label));
    setLabelOpen(nextOpen);
  };

  const applyLabel = () => {
    updateAttributes({ label: clampSpoilerLabel(labelDraft) });
    setLabelOpen(false);
  };

  const toolbarButtonClass = "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";

  return (
    <NodeViewWrapper
      as="div"
      data-spoiler-block="true"
      data-open={open ? "true" : "false"}
      className={`spoiler-block group/spoiler my-2 overflow-hidden rounded-xl border bg-card/60 ${
        selected ? "border-primary/60" : "border-border/70"
      }`}
    >
      <div
        contentEditable={false}
        className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5"
      >
        <button
          type="button"
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
        >
          {open ? (
            <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate">{label}</span>
          <span className="ml-2 shrink-0 text-xs font-normal text-muted-foreground">
            {open ? "Скрыть" : "Показать"}
          </span>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
          />
        </button>

        <Popover open={labelOpen} onOpenChange={openLabelEditor}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Текст спойлера"
              className={toolbarButtonClass}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            className="w-64 space-y-2 p-3"
            style={{ zIndex: 70 }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-xs font-medium text-muted-foreground">Текст на спойлере</span>
            <Input
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              placeholder="Например: Спойлер к серии"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLabel();
                }
              }}
            />
            <Button type="button" size="sm" className="w-full" onClick={applyLabel}>
              Применить
            </Button>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Удалить спойлер"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Same height animation as the read view (grid rows 0fr → 1fr). */}
      <div
        data-spoiler-reveal="true"
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div
          className={`min-h-0 overflow-hidden transition-[opacity,transform,visibility] duration-300 ease-out motion-reduce:transition-none ${
            open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
          }`}
        >
          <NodeViewContent className="spoiler-block__content px-3 pb-3 pt-1" />
        </div>
      </div>
    </NodeViewWrapper>
  );
};
