// Slash ("/") command menu for the wall composer.
//
// Typing "/" at the start of a line (or after a space) opens a command palette;
// picking an entry inserts a block at the caret — a media picker trigger, a
// gallery, or a divider. The menu only orchestrates: the composer owns the file
// input, the media commands own insertion.

import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionKeyDownProps, SuggestionOptions } from "@tiptap/suggestion";
import { Image as ImageIcon, EyeOff, LayoutDashboard, Link2, Minus } from "lucide-react";

import { SlashCommandList, type SlashCommandListHandle } from "./SlashCommandList";

export interface SlashActions {
  /** Open the composer's file picker (multiple files → gallery). */
  requestMedia: () => void;
  /** Open the link-card dialog (URL → preview). */
  requestLinkCard: () => void;
  /** Open the spoiler dialog (label → spoiler block). */
  requestSpoiler: () => void;
}

interface Range {
  from: number;
  to: number;
}

export interface SlashItem {
  key: string;
  title: string;
  hint: string;
  keywords: string[];
  Icon: typeof ImageIcon;
  run: (args: { editor: Editor; range: Range; actions: SlashActions }) => void;
}

export const slashItems: SlashItem[] = [
  {
    key: "media",
    title: "Фото или видео",
    hint: "Загрузить файлы в запись",
    keywords: ["медиа", "фото", "видео", "image", "photo", "video", "media", "file"],
    Icon: ImageIcon,
    run: ({ editor, range, actions }) => {
      editor.chain().focus().deleteRange(range).run();
      actions.requestMedia();
    },
  },
  {
    key: "gallery",
    title: "Галерея",
    hint: "Несколько файлов умной мозаикой",
    keywords: ["галерея", "gallery", "мозаика", "коллаж", "grid", "collage"],
    Icon: LayoutDashboard,
    run: ({ editor, range, actions }) => {
      editor.chain().focus().deleteRange(range).run();
      actions.requestMedia();
    },
  },
  {
    key: "divider",
    title: "Разделитель",
    hint: "Горизонтальная линия",
    keywords: ["разделитель", "линия", "hr", "divider", "line"],
    Icon: Minus,
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    key: "link",
    title: "Ссылка-карточка",
    hint: "Карточка с предпросмотром",
    keywords: ["ссылка", "link", "card", "карточка", "url"],
    Icon: Link2,
    run: ({ editor, range, actions }) => {
      editor.chain().focus().deleteRange(range).run();
      actions.requestLinkCard();
    },
  },
  {
    key: "spoiler",
    title: "Спойлер",
    hint: "Блок «нажми, чтобы показать»",
    keywords: ["спойлер", "spoiler", "скрыть", "hide", "reveal"],
    Icon: EyeOff,
    run: ({ editor, range, actions }) => {
      editor.chain().focus().deleteRange(range).run();
      actions.requestSpoiler();
    },
  },
];

export const filterSlashItems = (query: string): SlashItem[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return slashItems;
  return slashItems.filter(
    (item) =>
      item.title.toLowerCase().includes(normalized) ||
      item.keywords.some((keyword) => keyword.includes(normalized)),
  );
};

export const slashCommandPluginKey = new PluginKey("slashCommand");

// The editor's Enter-to-submit listener must not fire while this popup is open.
let slashPopupActive = false;
export const isSlashPopupActive = () => slashPopupActive;

const slashSuggestion = (
  actions: SlashActions,
): Omit<SuggestionOptions<SlashItem, SlashItem>, "editor"> => ({
  pluginKey: slashCommandPluginKey,
  char: "/",
  // Default allowedPrefixes [" "] permits the start of a line and a space, and
  // rejects a "/" inside a word (e.g. "и/или").
  items: ({ query }) => filterSlashItems(query),
  command: ({ editor, range, props }) => props.run({ editor, range, actions }),
  render: () => {
    let component: ReactRenderer<SlashCommandListHandle, object> | null = null;
    let unmount: (() => void) | null = null;
    return {
      onStart: (props) => {
        slashPopupActive = true;
        component = new ReactRenderer(SlashCommandList, { props, editor: props.editor, className: "z-[9999]" });
        unmount = props.mount(component.element);
      },
      onUpdate: (props) => component?.updateProps(props),
      onKeyDown: (props: SuggestionKeyDownProps) => component?.ref?.onKeyDown(props) ?? false,
      onExit: () => {
        slashPopupActive = false;
        unmount?.();
        component?.destroy();
        component = null;
        unmount = null;
      },
    };
  },
});

export const createSlashCommand = (actions: SlashActions) =>
  Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [Suggestion<SlashItem, SlashItem>({ editor: this.editor, ...slashSuggestion(actions) })];
    },
  });
