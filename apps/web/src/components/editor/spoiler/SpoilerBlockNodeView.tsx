// Editor NodeView for a spoiler block: a label header with a show/hide toggle,
// a label editor and a delete action. The content is editable while revealed and
// blurred/inert while collapsed. Starts revealed so typing after insertion works.

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverPanel, PopoverTrigger } from "@/components/ui/popover";
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

  const toolbarButtonClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,box-shadow] duration-200 ease-out hover:bg-foreground/5 hover:text-foreground hover:shadow-sm";
  const deleteButtonClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-destructive transition-[color,background-color,box-shadow] duration-200 ease-out hover:bg-foreground/5 hover:shadow-sm";

  return (
    <NodeViewWrapper
      as="div"
      data-spoiler-block="true"
      data-open={open ? "true" : "false"}
      className={`spoiler-block group/spoiler my-2 overflow-hidden rounded-xl border bg-card/60 transition-shadow duration-200 ease-out hover:shadow-sm ${
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
            <button
              type="button"
              title="Текст спойлера"
              className={toolbarButtonClass}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Pencil className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverPanel side="bottom" align="end" className="w-64 !p-0">
            <div className="px-3 py-3">
              <Input
                autoFocus
                className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                placeholder="Текст на спойлере"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLabel();
                  }
                }}
              />
            </div>
            <div className="flex justify-end border-t border-border/60 px-1.5 py-1">
              <button
                type="button"
                onClick={applyLabel}
                className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Применить
              </button>
            </div>
          </PopoverPanel>
        </Popover>

        <button
          type="button"
          title="Удалить спойлер"
          className={deleteButtonClass}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <Trash2 className="h-4 w-4" />
        </button>
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
