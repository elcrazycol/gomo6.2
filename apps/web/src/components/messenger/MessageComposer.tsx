import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Smile, Camera } from "lucide-react";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { EmojiPicker } from "@/components/EmojiPicker";

import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { getMobileKeyboardState, isEditableElement } from "@/lib/mobileKeyboard";
import { hapticSuccess, hapticTick } from "@/lib/haptics";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import {
  prosemirrorToMessengerText,
  messengerTextToProsemirror,
  messengerTextToPlain,
  isMessengerTextEmpty,
  messengerPlainPreview,
} from "./messengerRichTextUtils";
import type { Attachment, MessageView, UploadingFile } from "./types";
import { VoiceRecorder } from "./VoiceRecorder";
import { formatFileSize, getAttachmentIcon } from "./core/display";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 1000;
// Duration of the emoji sheet's own exit slide (EmojiPicker: emoji-sheet-down
// 240ms). The attach sheet reuses it for its delayed unmount.
const EMOJI_EXIT_MS = 240;

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  onSend: () => void;
  /** A finished voice note, already uploaded; the parent sends the message. */
  onSendVoice?: (attachment: Attachment) => void;
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
  onSendVoice,
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
  // Stable editor ref callback: keeps the local handle and mirrors it into
  // composerRef (ChatView/MessengerView focus). The tiptap instance itself is
  // captured by the effect below (a ref callback runs during commit / render in
  // tests, so it must not call setState).
  const handleEditorRef = useCallback((node: GomoRichEditorHandle | null) => {
    editorRef.current = node;
    if (composerRef) {
      (composerRef as React.MutableRefObject<GomoRichEditorHandle | null>).current = node;
    }
  }, [composerRef]);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Pending native-picker session (launched from the touch attach sheet):
  // while it is up the app has visibly handed the screen to iOS; the close
  // signal (window focus) ends the attach session deterministically.
  const fileSheetFocusRef = useRef<(() => void) | null>(null);
  // While a keyboard-slot sheet (emoji panel / touch attach sheet) is up, the
  // soft keyboard is gone and the global --kb-inset drops to 0 — but the
  // composer must stay exactly where the keyboard was. The chat panel's LOCAL
  // --kb-inset shadows the global one for the `translate` lift (see
  // messenger.css), so the sheet session freezes it once at the keyboard's
  // height and removes it once on close: no glides, no follows, no timers.
  // The keyboard's FULL visual slot, captured once when a sheet opens: on iOS
  // the generic keyboard inset subtracts the expanded URL bar, but a bottom
  // sheet (fixed to the LAYOUT bottom) must fill the whole slot the keyboard
  // rendered — delta INCLUDING the bar. The bar collapses after the keyboard
  // hides, so the slot cannot be re-derived live; capture it at open.
  const sheetSlotRef = useRef(0);
  // The emoji panel and the touch attach sheet share ONE keyboard-slot swap
  // (useEmojiKeyboardSwap): only one of them can occupy the keyboard's space
  // at a time. `activeSheet` tells which one is up.
  const swap = useEmojiKeyboardSwap(editorRef);
  const { keyboardInset, viewportHeight, isTouch } = useMobileKeyboard();
  const [activeSheet, setActiveSheet] = useState<"emoji" | "attach" | null>(null);
  /**
   * The keyboard slot belongs to the emoji panel unless the attach sheet owns it.
   * A single derived value — no third "null" state to desync from `swap.open`.
   */
  const emojiPanelOpen = swap.open && activeSheet !== "attach";
  // The sheet/panel height: swap.height is the *keyboard height*, but the
  // lifted composer sits at the full visual slot (URL bar included) — the
  // panels must match it so no gap shows between the composer and the sheet.
  const [sheetSlot, setSheetSlot] = useState(0);
  // TOP edge (window coords) the sheet/panel is pinned to — the keyboard's top
  // in the full window. Bottom-anchoring lets a collapsing window (Firefox
  // iOS) carry the panel up, so panels are top-pinned instead (see the open
  // branch).
  const [sheetTop, setSheetTop] = useState(0);
  // While the attach sheet is closing it stays mounted (with the exit slide)
  // and unmounts after a short delay — so closing reads as one smooth motion.
  const [attachClosing, setAttachClosing] = useState(false);
  const attachCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveSheetRef = useRef(activeSheet);

  useEffect(() => () => {
    if (attachCloseTimerRef.current) clearTimeout(attachCloseTimerRef.current);
  }, []);

  // Drop a pending native-picker session listener on unmount (chat closed
  // while the picker is up).
  useEffect(() => () => {
    if (fileSheetFocusRef.current) {
      window.removeEventListener("focus", fileSheetFocusRef.current);
      fileSheetFocusRef.current = null;
    }
  }, []);
  // Bumped when the editor content must be re-seeded from `draft` (edit start,
  // external clear after send) — never on the editor's own keystrokes.
  const [editorResetKey, setEditorResetKey] = useState(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The exact draft value the editor last emitted (null until its first
  // change). Used to tell an EXTERNAL clear (send / cancel-edit empties the
  // parent draft) apart from the editor itself emptying. A boolean
  // "last change came from the editor" flag goes stale when the editor
  // re-emits a value that serializes to the SAME wire text — pressing Enter
  // appends a paragraph whose trailing newline is trimmed by the serializer,
  // so `setDraft` is a no-op, no re-render happens, and the flag stays true;
  // the send-clear then skipped the editor reset and left the text in the box.
  const lastEditorDraftRef = useRef<string | null>(null);
  const prevDraftRef = useRef(draft);
  const prevEditingIdRef = useRef(editingMessageId);

  const isEditing = editingMessageId != null;
  const plainDraft = useMemo(() => messengerTextToPlain(draft), [draft]);
  const hasContent = plainDraft.length > 0;
  // Recording a voice note — or holding an unsent one — owns the row: the input
  // is inert for the whole time, so a click or Tab can never land in the text
  // field underneath.
  const [voiceRowLocked, setVoiceRowLocked] = useState(false);
  const remaining = MAX_LENGTH - plainDraft.length;

  // A message already on its way never blocks the next one (Telegram's clock
  // exists precisely so the reader can keep writing).
  const canSend = isEditing
    ? hasContent
    : uploadingFiles.length === 0 && (hasContent || pendingAttachments.length > 0);

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
    // External clear: the parent emptied a previously non-empty draft while the
    // editor's own last emitted value was itself non-empty — the user did not
    // delete the text, so wipe the editor via a reset-key bump. When the editor
    // emptied itself (user selected-all + delete) `lastEditorDraftRef` is "" and
    // the reset is skipped, so the caret is never yanked mid-edit.
    if (
      prev !== "" &&
      draft === "" &&
      lastEditorDraftRef.current !== null &&
      lastEditorDraftRef.current !== ""
    ) {
      setEditorResetKey((key) => key + 1);
    }
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
      const next = prosemirrorToMessengerText(json);
      lastEditorDraftRef.current = next;
      setDraft(next);

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
    if (uploadingFiles.length === 0 && (hasContent || pendingAttachments.length > 0)) {
      stopTyping();
      // Wipe the editor in the SAME tick as the send: the optimistic store call
      // resolves only after a network round-trip, and waiting for it left the
      // sent text visible (and, on desktop, its Enter-inserted empty line) for
      // as long as the request took. clear() emits onChange, so the parent
      // draft lands on "" immediately too.
      editorRef.current?.clear();
      // The send is the one action a reader wants confirmed by touch; Telegram
      // ticks here too. Android gets the OS haptic, iOS a very quiet click.
      hapticSuccess();
      onSend();
    }
  }, [isEditing, draft, editingContent, editingMessageId, onSaveEdit, onCancelEdit, uploadingFiles, hasContent, pendingAttachments, stopTyping, onSend]);

  // ── Touch attach sheet (paperclip) ────────────────────────────────────────
  // On touch the paperclip does NOT open the native picker directly — iOS
  // steals the keyboard for the sheet and never hands it back (the 2026-08
  // attach bug: the keyboard "уезжает" ~2s after the tap, and the header
  // janks on the next open). Instead an in-app sheet takes the keyboard's
  // slot through the same swap machinery as the emoji panel: the editor blurs
  // deliberately, the composer stays lifted, nothing is left to chance. The
  // native picker only opens AFTER an explicit source choice, and the session
  // ends deterministically (window focus / files picked / any sheet close
  // path) — with the keyboard returning, since the editor is blurred by the
  // swap, so focus() reliably reopens it.
  const endAttachSession = useCallback(() => {
    if (fileSheetFocusRef.current) {
      window.removeEventListener("focus", fileSheetFocusRef.current);
      fileSheetFocusRef.current = null;
    }
    setActiveSheet(null);
    if (swap.open) swap.closePanel(true); // keyboard returns
  }, [swap]);

  const handleSheetClose = useCallback(() => {
    // Outside-tap / Escape: close WITHOUT the keyboard returning — the
    // composer glides down in sync with the sheet's exit slide.
    setActiveSheet(null);
    swap.closePanel(false);
  }, [swap]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onAttachFiles?.(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
    // A picker session produced files — end the attach session (keyboard back).
    endAttachSession();
  }, [onAttachFiles, endAttachSession]);

  // Desktop keeps the plain native dialog — no keyboard to protect there.
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAttachOption = useCallback((option: "camera" | "photo" | "file") => {
    const input = fileInputRef.current;
    if (!input) return;
    // One hidden input serves all three sources — reconfigure it per pick.
    if (option === "camera") {
      input.setAttribute("accept", "image/*");
      input.setAttribute("capture", "environment");
    } else if (option === "photo") {
      input.setAttribute("accept", "image/*");
      input.removeAttribute("capture");
    } else {
      input.setAttribute("accept", "image/*,video/*,audio/*,.pdf,.txt,.md");
      input.removeAttribute("capture");
    }
    // The native picker takes over; regaining window focus ends the attach
    // session and returns the keyboard (see endAttachSession).
    if (fileSheetFocusRef.current) {
      window.removeEventListener("focus", fileSheetFocusRef.current);
      fileSheetFocusRef.current = null;
    }
    const onWindowFocus = () => {
      window.removeEventListener("focus", onWindowFocus);
      fileSheetFocusRef.current = null;
      endAttachSession();
    };
    fileSheetFocusRef.current = onWindowFocus;
    window.addEventListener("focus", onWindowFocus);
    input.click();
  }, [endAttachSession]);

  // Trigger semantics for the shared keyboard slot: re-tap on the open
  // sheet's own trigger closes it (keyboard returns); tapping the OTHER
  // trigger while a sheet is up switches the slot's content without
  // summoning the keyboard. The composer's lift while a sheet is up is owned
  // by the sheet effect below (freeze-once local --kb-inset) — the triggers
  // do no measuring themselves.
  const handleEmojiTrigger = useCallback(() => {
    // A closing attach sheet must not linger over the emoji panel.
    setAttachClosing(false);
    if (swap.open && activeSheet === "attach") {
      setActiveSheet("emoji");
      return;
    }
    if (swap.open && activeSheet === "emoji") {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    // Already closing (the exit slide keeps it visible for ~300ms): a press in
    // that window means "close", and closing always returns the keyboard.
    if (!swap.open && swap.isSheetVisible()) {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    setActiveSheet("emoji");
    hapticTick(6);
    if (!swap.open) swap.toggle();
  }, [activeSheet, swap]);

  const handleAttachTrigger = useCallback(() => {
    setAttachClosing(false);
    if (swap.open && activeSheet === "attach") {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    if (swap.open && activeSheet === "emoji") {
      setActiveSheet("attach");
      return;
    }
    // Same exit-slide rule as the emoji trigger.
    if (!swap.open && swap.isSheetVisible()) {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    setActiveSheet("attach");
    hapticTick(6);
    if (!swap.open) swap.toggle();
  }, [activeSheet, swap]);

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

  // ── Focus retention on the composer chrome ────────────────────────────────
  // A press on the composer's non-interactive parts (pill padding, empty row
  // space, banners…) must not move focus AWAY: the browser would blur the
  // editor and on mobile the soft keyboard flies away as a result. preventDefault on mousedown cancels the browser's default focus
  // move; interactive targets — the editor itself, enabled buttons, links,
  // form fields — fall through and keep their native behaviour. Disabled
  // buttons are covered here as well: on iOS a tap on an inert control
  // dismisses the keyboard with no event to intercept on the button itself.
  // While NOTHING is focused, the chrome press claims the editor directly
  // (synchronously, in the same gesture) so the very first tap — e.g. right
  // after a reply — opens the keyboard cleanly instead of doing a cold open
  // on the next tap.
  const handleComposerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        "button:not(:disabled), a[href], input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='button'], label",
      )
    ) {
      return;
    }
    e.preventDefault();
    // A press on the composer chrome (pill padding, reply/edit banner…) while
    // the editor is NOT focused — e.g. the very first tap right after a reply
    // was armed — claims focus SYNCHRONOUSLY in the same gesture, so the soft
    // keyboard opens cleanly with the tap. Without this the tap is eaten here
    // (preventDefault, nothing happens) and the NEXT tap on the editor does a
    // cold keyboard open that makes the composer jump. With an emoji/attach
    // sheet session up, the chrome belongs to that session — keep the old
    // no-op.
    if (!swap.open) {
      const active = typeof document !== "undefined" ? document.activeElement : null;
      const editing = !!active && active !== document.body && isEditableElement(active);
      if (!editing) editorRef.current?.focus();
    }
  }, [swap.open]);

  // ── Emoji (wall-post behaviour: keyboard swap on touch, popover on desktop) ─
  const handleEmojiSelect = useCallback((data: { emojiId: string; packId: string; url: string; name: string }) => {
    if (swap.open) {
      // Panel replaced the keyboard: insert at the saved caret WITHOUT
      // refocusing, so the keyboard stays hidden and the user can keep
      // adding emojis.
      editorRef.current?.insertEmoji(data, { focus: false });
    } else {
      editorRef.current?.focus();
      editorRef.current?.insertEmoji(data);
    }
  }, [swap.open]);

  // The window's FULL height with the keyboard dismissed — the max innerHeight
  // seen since mount. On engines that collapse innerHeight WITH the keyboard
  // (window-collapse engines, e.g. Firefox iOS: the vv-delta stays 0 there),
  // baseline − innerHeight IS the keyboard's height and feeds the slot, so the
  // sheet still fills the keyboard's space. On constant-window engines the
  // shrink is 0 and the vv-based numbers own the geometry.
  const baselineHeightRef = useRef<number | null>(null);
  // Once a window-collapse engine is observed, the swap height (a provisional
  // guess there — the hook cannot measure a keyboard it cannot see) never
  // feeds the slot floor again.
  const collapseEngineRef = useRef(false);

  // Tracks the full-window baseline on every render (no state — just a max).
  useEffect(() => {
    const winH = typeof window !== "undefined" ? window.innerHeight : 0;
    if (winH > 0 && (baselineHeightRef.current === null || winH > baselineHeightRef.current)) {
      baselineHeightRef.current = winH;
    }
  });

  // Freeze the sheet lift: compute the slot and write the local override.
  // One formula for both engines — lift = slot − shrink: on constant-window
  // engines the shrink is 0 and the composer sits at the full slot; on
  // collapse engines the lift tracks the window's seat (0 while collapsed —
  // the composer already sits at the keyboard's top — growing as the window
  // grows back). Idempotent: re-freezing the same values moves nothing.
  const freezeSheetLift = useCallback(() => {
    const chatPanel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!chatPanel) return;
    const winH = typeof window !== "undefined" ? window.innerHeight : 0;
    const shrink = baselineHeightRef.current !== null
      ? Math.max(0, baselineHeightRef.current - winH)
      : 0;
    if (shrink > 0) collapseEngineRef.current = true;
    // The slot is the keyboard's full visual footprint. keyboardInset already
    // subtracts the iOS URL bar, but a bottom sheet (fixed to the LAYOUT
    // bottom) must fill the whole visual slot — delta INCLUDING the bar — or
    // a gap shows between the composer and the sheet. The floor never shrinks
    // across sessions: a re-open can capture the keyboard mid-rise (a fragment
    // of its height), which would shrink the panel.
    const delta = Math.round(winH - viewportHeight);
    const candidate = collapseEngineRef.current
      ? Math.max(keyboardInset, delta, shrink)
      : Math.max(swap.height, keyboardInset, delta);
    if (candidate > sheetSlotRef.current) sheetSlotRef.current = candidate;
    const slot = sheetSlotRef.current;
    if (sheetSlot !== slot) setSheetSlot(slot);
    // Top-pin the panel: the keyboard's top edge in the full window. A fixed
    // full-height baseline keeps the top stable while the window grows/shrinks
    // around it (URL-bar collapse), instead of riding the resize.
    const topVal = Math.max(0, Math.round(baselineHeightRef.current ?? winH) - slot);
    setSheetTop(topVal);
    const lift = Math.max(0, slot - shrink);
    if (lift > 0) chatPanel.style.setProperty("--kb-inset", `${lift}px`);
    else chatPanel.style.removeProperty("--kb-inset");
  }, [swap.height, keyboardInset, viewportHeight, sheetSlot]);

  // ── Keyboard-slot sheet (emoji / touch attach) ↔ keyboard ─────────────────
  // The chat panel's local --kb-inset shadows the global one for the
  // `translate` lift (see messenger.css). While a keyboard-swap sheet is up,
  // the soft keyboard is gone and the global inset drops to 0 — so the sheet
  // session freezes the local var and removes it on close. No glides, no
  // follows, no timers: open and close are each a single step, and the global
  // module keeps writing the live geometry underneath (shadowed, never
  // fighting). Layout effect: the freeze commits before the browser paints,
  // so the open never flashes the composer at the bottom for a frame.
  useLayoutEffect(() => {
    const chatPanel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!chatPanel) return;
    if (!swap.open) {
      chatPanel.style.removeProperty("--kb-inset");
      return;
    }
    freezeSheetLift();
  }, [swap.open, freezeSheetLift]);

  // Collapse engines can grow/shrink the window with NO visual-viewport event
  // that reaches React state (the global module sees an unchanged delta and
  // doesn't re-render) — re-freeze synchronously in the resize handler so the
  // composer stays glued to the sheet's top edge regardless of frames.
  useEffect(() => {
    if (!swap.open) return;
    const onResize = () => freezeSheetLift();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [swap.open, freezeSheetLift]);

  // Keyboard-geometry diagnostics strip: live numbers pinned to the screen
  // (visualViewport vs state vs the composer's local lift). The whole
  // sheet↔keyboard choreography depends on values that cannot be reproduced in
  // jsdom — on-device recordings with these numbers show exactly what the engine
  // reports at the moment of a jump.
  //
  // Opt-in only: the strip used to appear in every dev build, which put a green
  // panel over the chat for anyone running the dev stack (it is not something a
  // messenger user should have to ignore). Enable it when debugging:
  //   localStorage.setItem("kb-diag", "1")  + reload
  // and remove the key (or clear site data) to get rid of it.
  useEffect(() => {
    const enabled =
      typeof localStorage !== "undefined" && localStorage.getItem("kb-diag") === "1";
    if (!enabled) return;
    const strip = document.createElement("div");
    strip.id = "kb-diag";
    strip.style.cssText =
      "position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "background:rgba(10,10,10,.82);color:#7dfc9b;font:11px/1.5 ui-monospace,Menlo,monospace;" +
      "padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre;" +
      "max-width:96vw;overflow:hidden;text-align:left;";
    document.body.appendChild(strip);
    let raf = 0;
    const render = () => {
      const vv = typeof window !== "undefined" ? window.visualViewport : null;
      const kb = getMobileKeyboardState();
      const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
      const local = panel ? panel.style.getPropertyValue("--kb-inset") || "''" : "—";
      const active =
        typeof document !== "undefined" && document.activeElement
          ? document.activeElement.tagName
          : "—";
      const lines = [
        `open:${String(swap.open)} sheet:${String(activeSheet)} slot:${sheetSlot} top:${sheetTop} h:${swap.height}`,
        `kbInset:${kb.keyboardInset} vv:${vv ? Math.round(vv.height) : "—"} / ${typeof window !== "undefined" ? window.innerHeight : "—"} offT:${vv ? Math.round(vv.offsetTop) : "—"}`,
        `local:${local}`,
        `focus:${active} scroll:${typeof window !== "undefined" ? window.scrollY : "—"}`,
      ].join("\n");
      if (strip.textContent !== lines) strip.textContent = lines;
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      strip.remove();
    };
  }, [swap.open, activeSheet, sheetSlot, sheetTop, swap.height]);

  // Clean up the local lift override on unmount.
  useEffect(() => () => {
    rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
  }, []);

  // The attach sheet exits with a slide whenever the swap closes from ANY
// path — trigger re-tap, outside tap/Escape, or the hook's own focusin when
// the user taps back into the editor (keyboard returning). Done as a
// RENDER-PHASE adjustment (React re-renders immediately, BEFORE committing):
// an effect-driven version would unmount the sheet for a frame and re-mount
// it to play the exit animation — the visible "panel flies up then slides
// down" pop. Mirrors EmojiPicker's swapClosing.
if (!swap.open && prevActiveSheetRef.current === "attach" && !attachClosing) {
  setAttachClosing(true);
}
useEffect(() => {
  prevActiveSheetRef.current = activeSheet;
}, [activeSheet]);
useEffect(() => {
  if (swap.open) {
    if (attachCloseTimerRef.current !== null) {
      clearTimeout(attachCloseTimerRef.current);
      attachCloseTimerRef.current = null;
    }
    return;
  }
  if (!attachClosing) return;
  if (attachCloseTimerRef.current === null) {
    attachCloseTimerRef.current = setTimeout(() => {
      attachCloseTimerRef.current = null;
      setAttachClosing(false);
    }, EMOJI_EXIT_MS);
  }
}, [swap.open, attachClosing]);

  // Outside tap / Escape closes the attach sheet WITHOUT the keyboard (the
  // composer glides down in sync) — same semantics as the emoji panel. The
  // sheet is a body portal, so the composer's own mousedown guard cannot
  // cover it; listen at the document level instead.
  useEffect(() => {
    if (!(swap.open && activeSheet === "attach")) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".composer-attach-sheet")) return;
      // A tap on the composer chrome (pill / toolbar — where BOTH panel
      // triggers live) while a sheet is up is a SWITCH or the trigger's own
      // re-tap business, not an outside tap: closing here would glide the
      // composer down to the bottom while the other panel opens (the
      // "composer drops on attach↔emoji switch").
      if (target?.closest(".composer")) return;
      // A tap on an editable (the composer's editor) must NOT close the sheet
      // here: the tap's own focus closes the swap through the hook's focusin,
      // and the lift is held + the keyboard returns smoothly (refocus path).
      // Closing here would glide the composer DOWN while the keyboard rises —
      // the "blink" on switching back to typing.
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      handleSheetClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSheetClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [swap.open, activeSheet, handleSheetClose]);

  // Telegram's rule: an empty composer offers the microphone, typing swaps it
  // for send. Editing an existing message never records.
  const showVoiceRecorder = Boolean(onSendVoice)
    && !isEditing
    && !hasContent
    && pendingAttachments.length === 0
    && uploadingFiles.length === 0;

  // `inert` blocks pointer events, focus and the accessibility tree in one go;
  // the opaque draft bar covers the row visually.
  useEffect(() => {
    const row = rootRef.current?.querySelector(".composer-row");
    if (!row) return;
    const targets = Array.from(
      row.querySelectorAll<HTMLElement>(":scope > .composer-attach-btn-wrap, :scope > .composer-input-pill, :scope > .send-button"),
    );
    targets.forEach((element) => element.toggleAttribute("inert", voiceRowLocked));
    return () => targets.forEach((element) => element.removeAttribute("inert"));
  }, [voiceRowLocked]);

  const sendButton = (
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
  );

  const emojiPicker = (
    <EmojiPicker
      onEmojiSelect={handleEmojiSelect}
      triggerRef={emojiButtonRef}
      keyboardSwap
      swapOpen={emojiPanelOpen}
      swapHeight={sheetSlot || swap.height}
      swapTop={sheetTop}
      onSwapToggle={handleEmojiTrigger}
      onSwapClose={handleSheetClose}
    >
      <button
        type="button"
        className={`composer-emoji-btn${emojiPanelOpen ? " is-active" : ""}`}
        title={emojiPanelOpen ? "Скрыть эмодзи" : "Добавить эмодзи"}
        aria-label={emojiPanelOpen ? "Скрыть эмодзи" : "Добавить эмодзи"}
        aria-pressed={emojiPanelOpen}
      >
        <Smile size={15} />
      </button>
    </EmojiPicker>
  );

  const attachFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*,video/*,audio/*,.pdf,.txt,.md"
      onChange={handleFileSelect}
      style={{ display: "none" }}
    />
  );

  const attachButton = (
    <button
      type="button"
      className="composer-attach-btn"
      onClick={isTouch ? handleAttachTrigger : openFilePicker}
      onMouseDown={(e) => e.preventDefault()}
      aria-label="Прикрепить файл"
    >
      <Paperclip size={18} />
    </button>
  );

  // Banners shared by the inline composer.
  const composerBanners = (
    <>
      {replyToMessage && (
        <div className="composer-reply-banner">
          <CornerDownRight size={14} style={{ color: "oklch(var(--primary))", flexShrink: 0 }} />
          <span className="reply-label">{replySenderLabel}</span>
          <span className="reply-text">
            {replyToMessage.is_deleted ? "Удалено" : messengerPlainPreview(replyToMessage.content, 120)}
          </span>
          {/* The ✕ must NOT steal focus from the editor: the browser's mousedown
              default would blur it (dismissing the iOS keyboard) and leave a
              focus ring. preventDefault cancels that; the click still fires and
              the editor is re-focused synchronously in the same gesture. */}
          <button
            type="button"
            className="composer-reply-cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onCancelReply?.();
              editorRef.current?.focus();
            }}
            aria-label="Отменить ответ"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {isEditing && (
        <div className="composer-edit-banner">
          <Pencil size={13} />
          <span>Редактирование</span>
          <button
            type="button"
            className="composer-edit-cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onCancelEdit?.();
              editorRef.current?.focus();
            }}
            aria-label="Отменить"
          >
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
              <button
                type="button"
                className="composer-attachment-remove"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleRemoveAttachment(i)}
                aria-label="Удалить"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // Touch attach sheet — occupies the keyboard's slot (same swap machinery as
  // the emoji panel). The native picker only opens after an explicit source
  // choice; the editor stays blurred and the composer lifted, so nothing in the
  // flow depends on iOS.
  const attachSheet = ((swap.open && activeSheet === "attach") || attachClosing) &&
    createPortal(
      <div
        className={`composer-attach-sheet${attachClosing ? " is-closing" : ""}`}
        data-testid="attach-sheet"
        style={{ ...(sheetTop > 0 ? { top: sheetTop } : {}), height: sheetSlot || swap.height || 300 }}
      >
        <button
          type="button"
          className="composer-attach-backdrop"
          aria-label="Закрыть меню"
          onClick={handleSheetClose}
        />
        <div className="composer-attach-options">
          <button type="button" className="composer-attach-option" onClick={() => handleAttachOption("camera")}>
            <Camera size={22} />
            <span>Камера</span>
          </button>
          <button type="button" className="composer-attach-option" onClick={() => handleAttachOption("photo")}>
            <ImageIcon size={22} />
            <span>Фото</span>
          </button>
          <button type="button" className="composer-attach-option" onClick={() => handleAttachOption("file")}>
            <FileText size={22} />
            <span>Файлы</span>
          </button>
        </div>
      </div>,
      document.body,
    );

  return (
    // The mousedown guard is not an interaction — it only cancels the
    // browser's default focus move on the chrome (see handleComposerMouseDown).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={rootRef}
      onMouseDown={handleComposerMouseDown}
      className={`composer${isSending ? " is-sending" : ""}${swap.open ? " is-sheet-open" : ""}`}
    >
      {composerBanners}

      <div className="composer-row">
        {/* Left of the input: the paperclip only. */}
        <div className="composer-attach-btn-wrap">
          {attachFileInput}
          {attachButton}
        </div>

        {/* The input pill — the emoji trigger lives inside it, on the right. */}
        <div className="composer-input-pill">
          <div className="composer-input-area" onPaste={handleEditorPaste}>
            <GomoRichEditor
              ref={handleEditorRef}
              resetKey={editorResetKey}
              maxLength={MAX_LENGTH}
              contentJson={editorJson}
              onChange={handleEditorChange}
              onSubmit={handleSubmit}
              placeholder={isEditing ? "" : placeholder ?? "Напиши сообщение..."}
              minHeightClassName="min-h-[20px]"
              maxHeightClassName="max-h-[128px] overflow-y-auto overscroll-contain"
              showToolbar={false}
              showSelectionToolbar
            />
          </div>

          {emojiPicker}

          {remaining < 100 && plainDraft.length > 0 && (
            <span className={`composer-counter ${remaining < 20 ? "is-critical" : ""}`}>
              {remaining}
            </span>
          )}
        </div>

        {/* Telegram's single round action button: microphone while the field is
            empty, send as soon as there is something to send. One fixed slot,
            so the swap is a quiet pop instead of a row reflow. */}
        <div className="composer-action-slot">
          {showVoiceRecorder && onSendVoice ? (
            <VoiceRecorder
              onSend={onSendVoice}
              onRowLockChange={setVoiceRowLocked}
            />
          ) : (
            sendButton
          )}
        </div>
      </div>

      {attachSheet}
    </div>
  );
});
