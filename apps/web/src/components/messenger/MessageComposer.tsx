import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Mic, Smile, Maximize2, Minimize2 } from "lucide-react";
import { GomoRichEditor, Toolbar, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { EmojiPicker } from "@/components/EmojiPicker";

import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { isEditableElement } from "@/lib/mobileKeyboard";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import {
  prosemirrorToMessengerText,
  messengerTextToProsemirror,
  messengerTextToPlain,
  isMessengerTextEmpty,
  messengerPlainPreview,
} from "./messengerRichTextUtils";
import type { Attachment, MessageView, UploadingFile } from "./types";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 1000;
// Duration of the emoji sheet's own exit slide (EmojiPicker: emoji-sheet-down
// 240ms). On a no-refocus close the composer glides down in sync with it.
const EMOJI_EXIT_MS = 240;

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  onSend: () => void;
  composerRef: RefObject<GomoRichEditorHandle | null>;
  onTyping?: (isTyping: boolean) => void;
  editingMessageId?: string | null;
  editingContent?: string;
  onCancelEdit?: () => void;
  onSaveEdit?: (messageId: string, content: string) => void;
  replyToMessage?: MessageView | null;
  replySenderLabel?: string;
  onCancelReply?: () => void;
  pendingAttachments?: Attachment[];
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  /** In-flight uploads shown as progress chips (uploadingFiles=[] hides the row). */
  uploadingFiles?: UploadingFile[];
  /** Starts uploading files; progress is reported back via `uploadingFiles`. */
  onAttachFiles?: (files: File[]) => void;
  placeholder?: string;
}

function getAttachmentIcon(type: Attachment["type"]) {
  switch (type) {
    case "image": return <ImageIcon size={16} />;
    case "audio": return <Mic size={16} />;
    default: return <FileText size={16} />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extract files pasted via Ctrl+V. clipboardData.items is the source of truth
 * (a pasted screenshot appears in both `files` and `items` — using items first
 * avoids attaching the same image twice); `files` is the fallback for browsers
 * that only populate it (e.g. Firefox for files copied from disk).
 */
function getPastedFiles(e: React.ClipboardEvent<HTMLElement>): File[] {
  const items = e.clipboardData?.items;
  if (items && items.length > 0) {
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) return files;
  }
  return Array.from(e.clipboardData?.files ?? []);
}

/**
 * Messenger composer — always visible, autogrowing input (Telegram/Discord
 * style):
 *
 *  • the input grows with its content up to a max height, then scrolls;
 *  • the emoji button (right, before send) swaps the soft keyboard for the
 *    emoji panel on touch and opens a popover on desktop
 *    (useEmojiKeyboardSwap + EmojiPicker keyboardSwap);
 *  • the ▢ button opens the "full" composer: the formatting toolbar (bold /
 *    color / blur / …) slides in above the input;
 *  • reply / edit / attachment / upload banners stay in flow above the input.
 *
 * The draft is stored in the messenger wire format (BBCode + [e:…] tokens, see
 * messengerRichText.ts) and is edited through GomoRichEditor, so emojis render
 * inline as images and formatting survives the round-trip.
 */
export const MessageComposer = memo(function MessageComposer({
  draft,
  setDraft,
  isSending,
  onSend,
  composerRef,
  onTyping,
  editingMessageId,
  editingContent,
  onCancelEdit,
  onSaveEdit,
  replyToMessage,
  replySenderLabel,
  onCancelReply,
  pendingAttachments = [],
  onAttachmentsChange,
  uploadingFiles = [],
  onAttachFiles,
  placeholder,
}: Props) {
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Eased descent of the local --kb-inset override when the emoji panel closes
  // without the keyboard returning (outside tap / Escape). Kept in refs so the
  // rAF loop can run without re-rendering the composer.
  const emojiGlideRafRef = useRef<number | null>(null);
  const emojiGlideActiveRef = useRef(false);
  const emojiGlideStartRef = useRef(0);
  const emojiGlideFromRef = useRef(0);
  const emojiSwap = useEmojiKeyboardSwap(editorRef);
  const { keyboardInset } = useMobileKeyboard();

  const [fullMode, setFullMode] = useState(false);
  // While the formatting panel is closing it stays mounted (with the exit
  // animation) and unmounts after a short delay — so closing reads as one
  // smooth motion instead of a hard pop.
  const [panelExiting, setPanelExiting] = useState(false);
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (panelExitTimerRef.current) clearTimeout(panelExitTimerRef.current);
  }, []);
  // Bumped when the editor content must be re-seeded from `draft` (edit start,
  // external clear after send) — never on the editor's own keystrokes.
  const [editorResetKey, setEditorResetKey] = useState(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastChangeFromEditorRef = useRef(false);
  const prevDraftRef = useRef(draft);
  const prevEditingIdRef = useRef(editingMessageId);

  const isEditing = editingMessageId != null;
  const plainDraft = useMemo(() => messengerTextToPlain(draft), [draft]);
  const hasContent = plainDraft.length > 0;
  const remaining = MAX_LENGTH - plainDraft.length;

  const canSend = isEditing
    ? hasContent
    : !isSending && uploadingFiles.length === 0 && (hasContent || pendingAttachments.length > 0);

  const editorJson = useMemo(
    () => (draft.trim() ? messengerTextToProsemirror(draft) : EMPTY_EDITOR_STATE),
    [draft],
  );

  // ── Editor re-seeding ──────────────────────────────────────────────────────
  // Editing starts → load the message content. Draft cleared externally
  // (send / cancel edit) → wipe the editor. Both bump the reset key.
  useEffect(() => {
    if (editingMessageId !== prevEditingIdRef.current) {
      prevEditingIdRef.current = editingMessageId;
      setEditorResetKey((key) => key + 1);
    }
  }, [editingMessageId]);

  useEffect(() => {
    const prev = prevDraftRef.current;
    prevDraftRef.current = draft;
    if (prev !== "" && draft === "" && !lastChangeFromEditorRef.current) {
      setEditorResetKey((key) => key + 1);
      setFullMode(false);
    }
    lastChangeFromEditorRef.current = false;
  }, [draft]);

  // ── Typing indicator ───────────────────────────────────────────────────────
  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping?.(false);
    }
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }, [onTyping]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  const handleEditorChange = useCallback(
    ({ json, text }: { json: unknown; text: string }) => {
      lastChangeFromEditorRef.current = true;
      setDraft(prosemirrorToMessengerText(json));

      if (onTyping && text.trim().length > 0) {
        if (!isTypingRef.current) {
          isTypingRef.current = true;
          onTyping(true);
        }
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
          isTypingRef.current = false;
          onTyping(false);
          typingTimer.current = null;
        }, TYPING_DEBOUNCE_MS);
      } else if (onTyping) {
        stopTyping();
      }
    },
    [setDraft, onTyping, stopTyping],
  );

  // ── Submit (send button, desktop Enter via GomoRichEditor) ─────────────────
  const handleSubmit = useCallback(() => {
    if (isEditing) {
      const meaningful = !isMessengerTextEmpty(draft);
      if (meaningful && draft.trim() !== editingContent && editingMessageId) {
        onSaveEdit?.(editingMessageId, draft.trim());
      } else {
        onCancelEdit?.();
      }
      return;
    }
    if (!isSending && uploadingFiles.length === 0 && (hasContent || pendingAttachments.length > 0)) {
      stopTyping();
      onSend();
    }
  }, [isEditing, draft, editingContent, editingMessageId, onSaveEdit, onCancelEdit, isSending, uploadingFiles, hasContent, pendingAttachments, stopTyping, onSend]);

  // ── Files: paperclip, Ctrl+V ───────────────────────────────────────────────
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onAttachFiles?.(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onAttachFiles]);

  const handleEditorPaste = useCallback((e: React.ClipboardEvent<HTMLElement>) => {
    const files = getPastedFiles(e);
    if (files.length === 0) return; // plain text — let the editor handle it
    e.preventDefault();
    onAttachFiles?.(files);
  }, [onAttachFiles]);

  const handleRemoveAttachment = useCallback((index: number) => {
    if (onAttachmentsChange) {
      onAttachmentsChange(pendingAttachments.filter((_, i) => i !== index));
    }
  }, [pendingAttachments, onAttachmentsChange]);

  // ── Emoji (wall-post behaviour: keyboard swap on touch, popover on desktop) ─
  const handleEmojiSelect = useCallback((data: { emojiId: string; packId: string; url: string; name: string }) => {
    if (emojiSwap.open) {
      // Panel replaced the keyboard: insert at the saved caret WITHOUT
      // refocusing, so the keyboard stays hidden and the user can keep
      // adding emojis.
      editorRef.current?.insertEmoji(data, { focus: false });
    } else {
      editorRef.current?.focus();
      editorRef.current?.insertEmoji(data);
    }
  }, [emojiSwap.open]);

  // ── Full composer: the ▢ opens a full-width formatting panel above the
  // input pill and relocates to its left edge; the bottom slot it vacated
  // becomes the paperclip attach button. ─────────────────────────────────────
  const openFullMode = useCallback(() => {
    setFullMode(true);
  }, []);

  const closeFullMode = useCallback(() => {
    setFullMode(false);
    setPanelExiting(true);
    if (panelExitTimerRef.current) clearTimeout(panelExitTimerRef.current);
    panelExitTimerRef.current = setTimeout(() => setPanelExiting(false), 220);
  }, []);

  const stopEmojiGlide = useCallback(() => {
    if (emojiGlideRafRef.current !== null) {
      cancelAnimationFrame(emojiGlideRafRef.current);
      emojiGlideRafRef.current = null;
    }
    emojiGlideActiveRef.current = false;
  }, []);

  // ── Emoji panel ↔ keyboard: the panel occupies the keyboard's space ──────
  // The chat panel is bottom-anchored at --kb-inset (see messenger.css), so
  // the composer — always in flow at the panel's bottom — floats above the
  // keyboard with no pinning at all. While the keyboard-swap emoji panel is
  // up the keyboard is gone and --kb-inset drops to 0, which would let the
  // panel cover the composer; instead the chat panel's LOCAL --kb-inset is
  // overridden with the panel height (matching the keyboard that just
  // dismissed — the composer does not move). On close:
  //   • keyboard returning (tap on the editor / toggle → refocus): the
  //     override is removed instantly and the global --kb-inset (updated
  //     synchronously by lib/mobileKeyboard on every visual-viewport event)
  //     rides the composer back up with no React-driven copy lagging behind;
  //   • no-refocus close (outside tap / Escape): the keyboard stays gone, so
  //     instead of teleporting the composer to the bottom in one frame it
  //     glides down with the panel's own exit slide (EMOJI_EXIT_MS).
  useEffect(() => {
    const chatPanel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!chatPanel) return;
    if (emojiSwap.open) {
      stopEmojiGlide();
      const lift = Math.max(emojiSwap.height, keyboardInset);
      chatPanel.style.setProperty("--kb-inset", `${lift}px`);
      return;
    }
    // Panel closed. An editable holding focus means the keyboard is coming
    // back (tap on the editor, toggle → refocus) — release the lift right
    // away so the live per-frame global --kb-inset takes over.
    if (typeof document !== "undefined" && isEditableElement(document.activeElement)) {
      stopEmojiGlide();
      chatPanel.style.removeProperty("--kb-inset");
      return;
    }
    // Outside-tap / Escape close: glide the composer down in sync with the
    // panel's exit instead of dropping it in one frame.
    const from = parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) || 0;
    if (from <= 0) {
      chatPanel.style.removeProperty("--kb-inset");
      return;
    }
    stopEmojiGlide();
    emojiGlideActiveRef.current = true;
    emojiGlideFromRef.current = from;
    emojiGlideStartRef.current = Date.now();
    const step = () => {
      emojiGlideRafRef.current = null;
      if (!emojiGlideActiveRef.current) return;
      const t = Math.min(1, (Date.now() - emojiGlideStartRef.current) / EMOJI_EXIT_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const inset = Math.round(emojiGlideFromRef.current * (1 - eased));
      if (inset <= 0) {
        emojiGlideActiveRef.current = false;
        chatPanel.style.removeProperty("--kb-inset");
        return;
      }
      chatPanel.style.setProperty("--kb-inset", `${inset}px`);
      emojiGlideRafRef.current = requestAnimationFrame(step);
    };
    emojiGlideRafRef.current = requestAnimationFrame(step);
  }, [emojiSwap.open, emojiSwap.height, keyboardInset, stopEmojiGlide]);

  // Clean up the local override and any in-flight glide on unmount.
  useEffect(() => () => {
    stopEmojiGlide();
    rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
  }, [stopEmojiGlide]);

  // The formatting panel's Toolbar needs the live tiptap instance. The pill
  // editor is always mounted, so the ref is populated before the panel can
  // render — read it at render time (the instance is stable across renders).
  const toolbarEditor = editorRef.current?.getEditor() ?? null;

  return (
    <div
      ref={rootRef}
      className={`composer${isSending ? " is-sending" : ""}${fullMode ? " is-full" : ""}${emojiSwap.open ? " is-emoji-open" : ""}`}
    >
      {replyToMessage && (
        <div className="composer-reply-banner">
          <CornerDownRight size={14} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
          <span className="reply-label">{replySenderLabel}</span>
          <span className="reply-text">
            {replyToMessage.is_deleted ? "Удалено" : messengerPlainPreview(replyToMessage.content, 120)}
          </span>
          <button type="button" className="composer-reply-cancel" onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={14} />
          </button>
        </div>
      )}
      {isEditing && (
        <div className="composer-edit-banner">
          <Pencil size={13} />
          <span>Редактирование</span>
          <button type="button" className="composer-edit-cancel" onClick={onCancelEdit} aria-label="Отменить">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Uploading files progress */}
      {uploadingFiles.length > 0 && (
        <div className="composer-attachments-preview">
          {uploadingFiles.map((file) => (
            <div key={file.id} className="composer-uploading-chip">
              <span className="composer-attachment-icon">{getAttachmentIcon(file.type)}</span>
              <span className="composer-uploading-info">
                <span className="composer-attachment-name">{file.name}</span>
                <span className="composer-uploading-bar">
                  <span className="composer-uploading-bar-fill" style={{ width: `${file.percent}%` }} />
                </span>
              </span>
              <span className="composer-uploading-pct">{file.percent}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div className="composer-attachments-preview">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="composer-attachment-chip">
              <span className="composer-attachment-icon">{getAttachmentIcon(att.type)}</span>
              <span className="composer-attachment-name">{att.name}</span>
              <span className="composer-attachment-size">{formatFileSize(att.size)}</span>
              <button type="button" className="composer-attachment-remove" onClick={() => handleRemoveAttachment(i)} aria-label="Удалить">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formatting panel — full-width row above the input, opened by the ▢
          button. The ▢ relocates to its left edge while it is open; the
          bottom slot it vacated becomes the paperclip attach button. */}
      {(fullMode || panelExiting) && (
        <div className={`composer-panel-row${panelExiting ? " is-exiting" : ""}`}>
          <button
            type="button"
            className="composer-panel-toggle"
            onClick={closeFullMode}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Свернуть компоузер"
            title="Свернуть"
          >
            <Minimize2 size={18} />
          </button>
          {toolbarEditor && <Toolbar editor={toolbarEditor} className="composer-toolbar-panel" />}
        </div>
      )}

      <div className="composer-row">
        {/* The ▢ full-composer toggle; while the panel is open the slot holds
            the paperclip attach button instead (the ▢ moved to the panel). */}
        {fullMode ? (
          <div className="composer-attach-btn-wrap is-visible">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.txt,.md"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="composer-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Прикрепить файл"
            >
              <Paperclip size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="composer-expand-btn"
            onClick={openFullMode}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Развернуть компоузер"
            title="Развернуть"
          >
            <Maximize2 size={18} />
          </button>
        )}

        {/* The input pill — emoji trigger lives inside it (right side) */}
        <div className="composer-input-pill">
          <div className="composer-input-area" onPaste={handleEditorPaste}>
            <GomoRichEditor
              ref={(node) => {
                // The local editorRef drives emoji insertion + the keyboard
                // swap; composerRef lets ChatView/MessengerView focus it.
                editorRef.current = node;
                if (composerRef) {
                  (composerRef as React.MutableRefObject<GomoRichEditorHandle | null>).current = node;
                }
              }}
              resetKey={editorResetKey}
              maxLength={MAX_LENGTH}
              contentJson={editorJson}
              onChange={handleEditorChange}
              onSubmit={handleSubmit}
              placeholder={isEditing ? "" : placeholder ?? "Напиши сообщение..."}
              minHeightClassName="min-h-[20px]"
              maxHeightClassName={
                fullMode
                  ? "max-h-[45vh] overflow-y-auto overscroll-contain"
                  : "max-h-[140px] overflow-y-auto overscroll-contain"
              }
              showToolbar={false}
            />
          </div>

          {/* Emoji — transparent circle inside the pill, vertically centered
              on the text line (wall-post behaviour: keyboard swap on touch,
              popover on desktop) */}
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            triggerRef={emojiButtonRef}
            keyboardSwap
            swapOpen={emojiSwap.open}
            swapHeight={emojiSwap.height}
            onSwapToggle={emojiSwap.toggle}
            onSwapClose={() => emojiSwap.closePanel(false)}
          >
            <button
              type="button"
              className="composer-emoji-btn"
              title="Добавить эмодзи"
              aria-label="Добавить эмодзи"
            >
              <Smile size={15} />
            </button>
          </EmojiPicker>

          {remaining < 100 && plainDraft.length > 0 && (
            <span className={`composer-counter ${remaining < 20 ? "is-critical" : ""}`}>
              {remaining}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`send-button${isEditing ? " is-edit" : ""}`}
          disabled={!canSend}
          aria-label={isEditing ? "Сохранить" : "Отправить"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSubmit}
        >
          {isEditing ? <Pencil size={16} /> : <SendHorizontal size={16} />}
        </button>
      </div>
    </div>
  );
});
