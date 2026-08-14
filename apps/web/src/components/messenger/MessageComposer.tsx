import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Mic, Smile, Maximize2, Minimize2 } from "lucide-react";
import { GomoRichEditor, Toolbar, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { EmojiPicker } from "@/components/EmojiPicker";

import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
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
 * Messenger composer (Telegram/Discord-style):
 *
 *  • collapsed by default — a quiet one-line pill (like the wall comment
 *    composer); tapping it expands the input;
 *  • the emoji button (right, before send) swaps the soft keyboard for the
 *    emoji panel on touch and opens a popover on desktop — identical to the
 *    wall post composer (useEmojiKeyboardSwap + EmojiPicker keyboardSwap);
 *  • the subtle ▢ rectangle to the left of the emoji button opens the "full"
 *    composer: the formatting toolbar (bold / color / blur / …) slides in and
 *    the input grows;
 *  • blur with an empty draft folds everything back into the pill.
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
  const emojiSwap = useEmojiKeyboardSwap(editorRef);

  const [expanded, setExpanded] = useState(false);
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
  // Timestamp of the last pointer-down inside the composer: blurs that follow
  // a tap on our own buttons (emoji trigger → keyboard-swap blur) must not
  // fold the composer, while a real outside tap / iOS scroll-dismiss may.
  const lastComposerPointerRef = useRef(0);

  const isEditing = editingMessageId != null;
  const plainDraft = useMemo(() => messengerTextToPlain(draft), [draft]);
  const hasContent = plainDraft.length > 0;
  const remaining = MAX_LENGTH - plainDraft.length;

  const canSend = isEditing
    ? hasContent
    : !isSending && uploadingFiles.length === 0 && (hasContent || pendingAttachments.length > 0);

  const isExpanded = expanded
    || Boolean(replyToMessage)
    || isEditing
    || fullMode
    || emojiSwap.open
    || pendingAttachments.length > 0
    || uploadingFiles.length > 0
    || hasContent;

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
      // Sent / edit saved / reply cancelled → fold back into the quiet pill,
      // mirroring the wall comment composer.
      setExpanded(false);
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

  // ── Emoji panel ↔ keyboard swap: keep the pill above the panel ────────────
  // While the swap panel is open it occupies exactly the space the soft
  // keyboard just left, so the chat panel (and the composer pill with it) must
  // float at the panel's height instead of following --kb-inset — which drops
  // to 0 the instant the keyboard hides, letting the panel slide over the pill
  // (the "keyboard covers the pill" bug, wall comments pin instead).
  //
  // On close the pill stays glued to the top edge of the departing panel:
  //  • refocus path (trigger toggle) — the keyboard rises back; hold the pill
  //    at the panel height and hand off to --kb-inset the moment the keyboard
  //    reaches it (no dip, no jump, even when the keyboard is taller than the
  //    panel — e.g. a predictive-text bar);
  //  • no-refocus path (outside tap / Escape) — the keyboard is not coming
  //    back; glide the pill down in sync with the panel's exit animation
  //    instead of holding then teleporting.
  useEffect(() => {
    const chatPanel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!chatPanel) return;
    const swapHeight = emojiSwap.height;
    if (emojiSwap.open && swapHeight > 0) {
      chatPanel.style.setProperty("--emoji-panel-h", `${swapHeight}px`);
      return;
    }
    if (swapHeight <= 0) {
      chatPanel.style.removeProperty("--emoji-panel-h");
      return;
    }
    const startedAt = Date.now();
    let timer: number | null = null;
    let glideRaf: number | null = null;
    let done = false;

    const cleanup = () => {
      done = true;
      if (timer !== null) clearTimeout(timer);
      if (glideRaf !== null) cancelAnimationFrame(glideRaf);
      timer = null;
      glideRaf = null;
    };

    const finish = () => {
      cleanup();
      chatPanel.style.removeProperty("--emoji-panel-h");
    };

    const glideDown = () => {
      if (done) return;
      cleanup();
      const animStart = performance.now();
      const glide = (now: number) => {
        if (done) return;
        const p = Math.min(1, (now - animStart) / 240);
        const eased = 1 - Math.pow(1 - p, 3);
        const h = Math.round(swapHeight * (1 - eased));
        if (h <= 0) {
          chatPanel.style.removeProperty("--emoji-panel-h");
          done = true;
          return;
        }
        chatPanel.style.setProperty("--emoji-panel-h", `${h}px`);
        glideRaf = requestAnimationFrame(glide);
      };
      glideRaf = requestAnimationFrame(glide);
    };

    const poll = () => {
      if (done) return;
      const inset =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb-inset")) || 0;
      const elapsed = Date.now() - startedAt;
      // The keyboard rose back to the panel's height → hand off to --kb-inset
      // (the pill keeps riding the keyboard from the same position).
      if (inset >= swapHeight - 8) {
        finish();
        return;
      }
      // The keyboard is coming back (the editor was refocused): hold the pill
      // at the panel height until it arrives.
      const active = document.activeElement;
      const editorFocused =
        active instanceof HTMLElement &&
        !!rootRef.current?.contains(active) &&
        isEditableElement(active);
      if (editorFocused) {
        if (elapsed > 2000) finish();
        else timer = window.setTimeout(poll, 40);
        return;
      }
      // No refocus: the keyboard is not coming back — glide the pill down in
      // sync with the panel's exit animation instead of holding then jumping.
      if (elapsed >= 150) {
        glideDown();
        return;
      }
      timer = window.setTimeout(poll, 40);
    };
    timer = window.setTimeout(poll, 40);
    return cleanup;
  }, [emojiSwap.open, emojiSwap.height]);

  // ── Expand / collapse ──────────────────────────────────────────────────────
  const requestCollapse = useCallback(() => {
    if (
      !hasContent
      && !replyToMessage
      && !isEditing
      && !emojiSwap.open
      && !fullMode
      && pendingAttachments.length === 0
      && uploadingFiles.length === 0
    ) {
      setExpanded(false);
    }
  }, [hasContent, replyToMessage, isEditing, emojiSwap.open, fullMode, pendingAttachments, uploadingFiles]);

  const handleComposerBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    // A blur right after a tap on one of our own buttons (emoji trigger
    // programmatically blurs the editor to summon the swap panel) is not a
    // reason to collapse.
    if (Date.now() - lastComposerPointerRef.current < 150) return;
    if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
    requestCollapse();
  }, [requestCollapse]);

  // The formatting panel's Toolbar needs the live tiptap instance. The pill
  // editor is always mounted, so the ref is populated before the panel can
  // render — read it at render time (the instance is stable across renders).
  const toolbarEditor = editorRef.current?.getEditor() ?? null;

  // Clicking an emoji in the desktop popover (a portal outside the composer)
  // first blurs the editor — without this the pill would flash-collapse right
  // before the emoji lands in the draft.
  useEffect(() => {
    const onEmojiSurfacePointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (
        target instanceof Element
        && target.closest('[data-testid="emoji-picker-popover"], [data-testid="emoji-keyboard-panel"]')
      ) {
        lastComposerPointerRef.current = Date.now();
      }
    };
    document.addEventListener("pointerdown", onEmojiSurfacePointer, true);
    return () => document.removeEventListener("pointerdown", onEmojiSurfacePointer, true);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`composer${isSending ? " is-sending" : ""}${isExpanded ? " is-expanded" : ""}${fullMode ? " is-full" : ""}`}
      onPointerDownCapture={() => {
        lastComposerPointerRef.current = Date.now();
      }}
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
            aria-label="Развернуть компоузер"
            title="Развернуть"
          >
            <Maximize2 size={18} />
          </button>
        )}

        {/* The input pill — emoji trigger lives inside it (right side) */}
        <div
          className="composer-input-pill"
          onFocusCapture={() => setExpanded(true)}
          onBlur={handleComposerBlur}
        >
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
              minHeightClassName={isExpanded ? "min-h-[44px]" : "min-h-[22px]"}
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
