import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SendHorizontal, X, Pencil, CornerDownRight, Paperclip, Image as ImageIcon, FileText, Mic, Smile, Maximize2, Minimize2, Camera } from "lucide-react";
import { GomoRichEditor, Toolbar, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { EmojiPicker } from "@/components/EmojiPicker";

import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { getMobileKeyboardState, isEditableElement } from "@/lib/mobileKeyboard";
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
/** How long to keep the composer's sheet-lift after a sheet closes with the
 *  keyboard returning: if the keyboard never actually rises (focus without a
 *  software keyboard, a shorter returning keyboard), release anyway so the
 *  composer settles at the live global --kb-inset instead of floating. */
const LIFT_HOLD_FALLBACK_MS = 800;
/** If the keyboard's return is reported only once (no second, equal report to
 *  confirm the settlement), remove the lift override this long after the last
 *  at-or-above report — bounded, so no stale override can ever block a later
 *  keyboard dismissal. */
const SETTLE_CONFIRM_MS = 250;

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
  // Pending native-picker session (launched from the touch attach sheet):
  // while it is up the app has visibly handed the screen to iOS; the close
  // signal (window focus) ends the attach session deterministically.
  const fileSheetFocusRef = useRef<(() => void) | null>(null);
  // Eased descent of the local --kb-inset override when a keyboard-slot sheet
  // closes without the keyboard returning (outside tap / Escape). Kept in
  // refs so the rAF loop can run without re-rendering the composer.
  const emojiGlideRafRef = useRef<number | null>(null);
  const emojiGlideActiveRef = useRef(false);
  const emojiGlideStartRef = useRef(0);
  const emojiGlideFromRef = useRef(0);
  const emojiGlideToRef = useRef(0);
  // The keyboard's FULL visual slot, captured once when a sheet opens: on iOS
  // the generic keyboard inset subtracts the expanded URL bar, but a bottom
  // sheet (fixed to the LAYOUT bottom) must fill the whole slot the keyboard
  // rendered — delta INCLUDING the bar. The bar collapses after the keyboard
  // hides, so the slot cannot be re-derived live; capture it at open.
  const sheetSlotRef = useRef(0);
  // Fallback release for a held lift on a refocus-close whose keyboard never
  // returns (focus without keyboard), and the settlement tracker for the
  // keyboard-return handoff (see the lift effect).
  const liftHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevInsetRef = useRef<number | null>(null);
  // Bounded confirmation timer for the keyboard-return handoff (see the
  // refocus branch): fires only when the settlement wasn't confirmed by a
  // second, equal report.
  const settleConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The emoji panel and the touch attach sheet share ONE keyboard-slot swap
  // (useEmojiKeyboardSwap): only one of them can occupy the keyboard's space
  // at a time. `activeSheet` tells which one is up.
  const swap = useEmojiKeyboardSwap(editorRef);
  const { keyboardInset, viewportHeight, isTouch } = useMobileKeyboard();
  const [activeSheet, setActiveSheet] = useState<"emoji" | "attach" | null>(null);
  // The sheet/panel height: swap.height is the *keyboard height*, but the
  // lifted composer sits at the full visual slot (URL bar included) — the
  // panels must match it so no gap shows between the composer and the sheet.
  const [sheetSlot, setSheetSlot] = useState(0);
  // While the attach sheet is closing it stays mounted (with the exit slide)
  // and unmounts after a short delay — so closing reads as one smooth motion.
  const [attachClosing, setAttachClosing] = useState(false);
  const attachCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveSheetRef = useRef(activeSheet);

  const [fullMode, setFullMode] = useState(false);
  // While the formatting panel is closing it stays mounted (with the exit
  // animation) and unmounts after a short delay — so closing reads as one
  // smooth motion instead of a hard pop.
  const [panelExiting, setPanelExiting] = useState(false);
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (panelExitTimerRef.current) clearTimeout(panelExitTimerRef.current);
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

  // Before a sheet opens over a REAL keyboard, pin the composer's lift to the
  // keyboard's height SYNCHRONOUSLY IN THE TAP HANDLER — before openPanel's
  // blur, hence before any engine reports the keyboard as gone. Firefox iOS
  // reports the dismissal early (inset → 0 while the keyboard is still
  // visibly collapsing); without this anchor the composer would drop under the
  // departing keyboard and then ride back up with the sheet. The local
  // --kb-inset also tells mobileKeyboard's focus-out guard to skip its
  // descent. No-op when the keyboard wasn't really up (sheet→sheet switch or
  // a closed keyboard — the desktop/stale cases keep the current lift).
  const anchorSheetLift = useCallback(() => {
    const inset = getMobileKeyboardState().keyboardInset;
    if (inset < 60) return; // no real keyboard above the composer
    const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!panel) return;
    const current = parseFloat(panel.style.getPropertyValue("--kb-inset")) || 0;
    if (inset > current) panel.style.setProperty("--kb-inset", `${inset}px`);
  }, []);

  // Trigger semantics for the shared keyboard slot: re-tap on the open
  // sheet's own trigger closes it (keyboard returns); tapping the OTHER
  // trigger while a sheet is up switches the slot's content without
  // summoning the keyboard.
  const handleEmojiTrigger = useCallback(() => {
    // A closing attach sheet must not linger over the emoji panel.
    setAttachClosing(false);
    anchorSheetLift();
    if (swap.open && activeSheet === "emoji") {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    if (swap.open && activeSheet === "attach") {
      setActiveSheet("emoji");
      return;
    }
    setActiveSheet("emoji");
    if (!swap.open) swap.toggle();
  }, [activeSheet, swap, anchorSheetLift]);

  const handleAttachTrigger = useCallback(() => {
    setAttachClosing(false);
    anchorSheetLift();
    if (swap.open && activeSheet === "attach") {
      setActiveSheet(null);
      swap.closePanel(true);
      return;
    }
    if (swap.open && activeSheet === "emoji") {
      setActiveSheet("attach");
      return;
    }
    setActiveSheet("attach");
    if (!swap.open) swap.toggle();
  }, [activeSheet, swap, anchorSheetLift]);

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
  // space, banners…) must not move focus: the browser would blur the editor
  // and on mobile the soft keyboard flies away as a result (mobileKeyboard's
  // handleFocusOut starts the eased composer descent on blur). preventDefault
  // on mousedown cancels the browser's default focus move; interactive
  // targets — the editor itself, enabled buttons, links, form fields — fall
  // through and keep their native behaviour. Disabled buttons are covered
  // here as well: on iOS a tap on an inert control dismisses the keyboard
  // with no event to intercept on the button itself.
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
  }, []);

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

  // ── Keyboard-slot sheet (emoji / touch attach) ↔ keyboard ─────────────────
  // The chat panel is bottom-anchored at --kb-inset (see messenger.css), so
  // the composer — always in flow at the panel's bottom — floats above the
  // keyboard with no pinning at all. While a keyboard-swap sheet is up the
  // keyboard is gone and --kb-inset drops to 0, which would let the sheet
  // cover the composer; instead the chat panel's LOCAL --kb-inset is
  // overridden with the sheet slot (the keyboard's full visual slot — the
  // generic inset minus the iOS URL bar, plus the collapsed-bar allowance, see
  // sheetSlotRef — matching where the keyboard was, so the composer does not
  // move). On close:
  //   • keyboard returning (tap on the editor / trigger → refocus): the global
  //     --kb-inset lags a couple of frames behind the rising keyboard (visual
  //     viewport events), so releasing the override instantly drops the
  //     composer to the bottom for a frame, then pops it back — the
  //     "composer disappears" jerk. Instead the lift is HELD until the live
  //     global catches up with the real keyboard height (then both coincide —
  //     releasing is seamless), with a timed fallback release;
  //   • no-refocus close (outside tap / Escape): the keyboard stays gone, so
  //     instead of teleporting the composer to the bottom in one frame it
  //     glides down with the sheet's own exit slide (EMOJI_EXIT_MS).
  useEffect(() => {
    const chatPanel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!chatPanel) return;
    if (swap.open) {
      // Fresh session: the keyboard-return settlement tracking starts clean.
      prevInsetRef.current = null;
      if (settleConfirmTimerRef.current !== null) {
        clearTimeout(settleConfirmTimerRef.current);
        settleConfirmTimerRef.current = null;
      }
      const delta = Math.round((typeof window !== "undefined" ? window.innerHeight : 0) - viewportHeight);
      const candidate = Math.max(swap.height, keyboardInset, delta);
      // The slot NEVER shrinks across sessions: a second open can capture the
      // keyboard mid-rise (a fragment of its height, e.g. right after a
      // refocus-close), which would shrink the panel; the previous slot is
      // the stable floor. The keyboard height is device-stable, so the floor
      // is safe — it only yields to a genuinely taller keyboard.
      if (candidate > sheetSlotRef.current) sheetSlotRef.current = candidate;
      const slot = sheetSlotRef.current;
      if (sheetSlot !== slot) setSheetSlot(slot);
      // The keyboard is still dismissing (and the URL bar still expanded)
      // when the sheet first opens — slapping the FULL slot on the composer
      // in one frame makes it jump (teleport) above its previous keyboard-top
      // seat, then settle when the bar collapses. Glide from the keyboard
      // position up to the slot in sync with the sheet's rise instead.
      stopEmojiGlide();
      const current = parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) || 0;
      // Start from the LIVE inset, not the captured swap.height: the composer
      // currently sits at the global (the override was released), and the
      // captured height can differ from it by a pixel or two — starting there
      // would visibly jump the composer by that amount on open.
      const from = current > 0 ? current : keyboardInset;
      if (from !== slot) {
        emojiGlideActiveRef.current = true;
        emojiGlideFromRef.current = from;
        emojiGlideToRef.current = slot;
        emojiGlideStartRef.current = Date.now();
        const step = () => {
          emojiGlideRafRef.current = null;
          if (!emojiGlideActiveRef.current) return;
          const t = Math.min(1, (Date.now() - emojiGlideStartRef.current) / EMOJI_EXIT_MS);
          const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
          const inset = Math.round(emojiGlideFromRef.current + (emojiGlideToRef.current - emojiGlideFromRef.current) * eased);
          if (t >= 1) {
            emojiGlideActiveRef.current = false;
            chatPanel.style.setProperty("--kb-inset", `${emojiGlideToRef.current}px`);
            return;
          }
          chatPanel.style.setProperty("--kb-inset", `${inset}px`);
          emojiGlideRafRef.current = requestAnimationFrame(step);
        };
        emojiGlideRafRef.current = requestAnimationFrame(step);
      } else {
        chatPanel.style.setProperty("--kb-inset", `${slot}px`);
      }
      return;
    }
    // Sheet closed. The captured slot stays as a floor for the next session
    // (see the open branch — a fresh open never shrinks it).
    // An editable holding focus means the keyboard is coming back (tap on the
    // editor, trigger → refocus). ONE continuous rule: the composer stays AT
    // the sheet's height while the keyboard slides up to it, and does NOT ride
    // transient reports that rise above it (engines like Firefox iOS report
    // the return higher than the keyboard really is — riding would yank the
    // composer up and back down). When the live inset has been reported TWICE
    // unchanged, the keyboard has settled at its final height: if that height
    // is within a pixel of the held lift the override is dropped (the global
    // equals the local — nothing moves and no stale override can block a later
    // descent); otherwise the composer glides to the true height (up or down).
    if (typeof document !== "undefined" && isEditableElement(document.activeElement)) {
      stopEmojiGlide();
      const held = parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) || 0;
      if (held <= 0) {
        prevInsetRef.current = null;
        chatPanel.style.removeProperty("--kb-inset");
        return;
      }
      const prevInset = prevInsetRef.current;
      prevInsetRef.current = keyboardInset;
      const settled =
        keyboardInset > 0 &&
        prevInset !== null &&
        keyboardInset === prevInset;
      if (settled) {
        if (liftHoldTimerRef.current !== null) {
          clearTimeout(liftHoldTimerRef.current);
          liftHoldTimerRef.current = null;
        }
        if (settleConfirmTimerRef.current !== null) {
          clearTimeout(settleConfirmTimerRef.current);
          settleConfirmTimerRef.current = null;
        }
        prevInsetRef.current = null;
        const currentLift = parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) || 0;
        if (Math.abs(currentLift - keyboardInset) > 1) {
          // The keyboard settled lower than the sheet's height — glide the
          // composer down to its real top.
          emojiGlideActiveRef.current = true;
          emojiGlideFromRef.current = currentLift;
          emojiGlideToRef.current = keyboardInset;
          emojiGlideStartRef.current = Date.now();
          const step = () => {
            emojiGlideRafRef.current = null;
            if (!emojiGlideActiveRef.current) return;
            const t = Math.min(1, (Date.now() - emojiGlideStartRef.current) / EMOJI_EXIT_MS);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            const inset = Math.round(emojiGlideFromRef.current + (emojiGlideToRef.current - emojiGlideFromRef.current) * eased);
            if (t >= 1) {
              emojiGlideActiveRef.current = false;
              chatPanel.style.removeProperty("--kb-inset");
              return;
            }
            chatPanel.style.setProperty("--kb-inset", `${inset}px`);
            emojiGlideRafRef.current = requestAnimationFrame(step);
          };
          emojiGlideRafRef.current = requestAnimationFrame(step);
        } else {
          // Equal — hand off with no movement.
          chatPanel.style.removeProperty("--kb-inset");
        }
        return;
      }
      if (keyboardInset < held) {
        // Keyboard still below the sheet's height: hold the lift in place.
        // If it never returns at all (focus without keyboard), release after
        // a short delay; the moment it starts rising, cancel that release.
        if (settleConfirmTimerRef.current !== null) {
          clearTimeout(settleConfirmTimerRef.current);
          settleConfirmTimerRef.current = null;
        }
        if (keyboardInset <= 0 && liftHoldTimerRef.current === null) {
          liftHoldTimerRef.current = setTimeout(() => {
            liftHoldTimerRef.current = null;
            rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
          }, LIFT_HOLD_FALLBACK_MS);
        } else if (keyboardInset > 0 && liftHoldTimerRef.current !== null) {
          clearTimeout(liftHoldTimerRef.current);
          liftHoldTimerRef.current = null;
        }
        return;
      }
      // The keyboard is at or above the held height, still moving (not settled
      // yet). The composer stays AT the sheet's height — engines like Firefox
      // iOS transiently report the return HIGHER than the keyboard really is,
      // and riding those reports would yank the composer up, then back down
      // ("teleport" once the keyboard finishes). The settled branch above
      // aligns the composer to the TRUE final height (gliding if it differs).
      // Arm a bounded confirmation so a return that is reported only once
      // still clears the override shortly after (nothing moves then: the local
      // equals the global — and no stale override can block a later dismissal).
      if (liftHoldTimerRef.current !== null) {
        clearTimeout(liftHoldTimerRef.current);
        liftHoldTimerRef.current = null;
      }
      if (settleConfirmTimerRef.current === null) {
        settleConfirmTimerRef.current = setTimeout(() => {
          settleConfirmTimerRef.current = null;
          rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
        }, SETTLE_CONFIRM_MS);
      }
      return;
    }
    prevInsetRef.current = null;
    // Outside-tap / Escape close: glide the composer down in sync with the
    // sheet's exit instead of dropping it in one frame.
    const from = parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) || 0;
    if (from <= 0) {
      chatPanel.style.removeProperty("--kb-inset");
      return;
    }
    stopEmojiGlide();
    emojiGlideActiveRef.current = true;
    emojiGlideFromRef.current = from;
    emojiGlideToRef.current = 0;
    emojiGlideStartRef.current = Date.now();
    const step = () => {
      emojiGlideRafRef.current = null;
      if (!emojiGlideActiveRef.current) return;
      const t = Math.min(1, (Date.now() - emojiGlideStartRef.current) / EMOJI_EXIT_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const inset = Math.round(emojiGlideFromRef.current + (emojiGlideToRef.current - emojiGlideFromRef.current) * eased);
      if (t >= 1 || inset <= 0) {
        emojiGlideActiveRef.current = false;
        chatPanel.style.removeProperty("--kb-inset");
        return;
      }
      chatPanel.style.setProperty("--kb-inset", `${inset}px`);
      emojiGlideRafRef.current = requestAnimationFrame(step);
    };
    emojiGlideRafRef.current = requestAnimationFrame(step);
  }, [swap.open, swap.height, keyboardInset, viewportHeight, sheetSlot, stopEmojiGlide]);

  // While a keyboard-slot sheet is up the soft keyboard is closed, so the
  // mobileKeyboard document-pan pin (active only while its state reports the
  // keyboard OPEN) stops — yet iOS still pans the fixed shell around the
  // sheet transition (header drifting, composer diving under the top bar).
  // Re-pin the document scroll for the whole sheet session.
  useEffect(() => {
    if (!(swap.open && isTouch)) return;
    let raf = 0;
    const step = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [swap.open, isTouch]);

  // Clean up the local override, the held-lift timer and any in-flight glide on
  // unmount.
  useEffect(() => () => {
    stopEmojiGlide();
    if (liftHoldTimerRef.current !== null) {
      clearTimeout(liftHoldTimerRef.current);
      liftHoldTimerRef.current = null;
    }
    if (settleConfirmTimerRef.current !== null) {
      clearTimeout(settleConfirmTimerRef.current);
      settleConfirmTimerRef.current = null;
    }
    rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
  }, [stopEmojiGlide]);

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

  // The formatting panel's Toolbar needs the live tiptap instance. The pill
  // editor is always mounted, so the ref is populated before the panel can
  // render — read it at render time (the instance is stable across renders).
  const toolbarEditor = editorRef.current?.getEditor() ?? null;

  return (
    // The mousedown guard is not an interaction — it only cancels the
    // browser's default focus move on the chrome (see handleComposerMouseDown).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={rootRef}
      onMouseDown={handleComposerMouseDown}
      className={`composer${isSending ? " is-sending" : ""}${fullMode ? " is-full" : ""}${swap.open ? " is-sheet-open" : ""}`}
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
              onClick={isTouch ? handleAttachTrigger : openFilePicker}
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
            swapOpen={swap.open && activeSheet === "emoji"}
            swapHeight={sheetSlot || swap.height}
            onSwapToggle={handleEmojiTrigger}
            onSwapClose={handleSheetClose}
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

      {/* Touch attach sheet — occupies the keyboard's slot (same swap
          machinery as the emoji panel). The native picker only opens after
          an explicit source choice; the editor stays blurred and the
          composer lifted, so nothing in the flow depends on iOS. */}
      {((swap.open && activeSheet === "attach") || attachClosing) &&
        createPortal(
          <div
            className={`composer-attach-sheet${attachClosing ? " is-closing" : ""}`}
            data-testid="attach-sheet"
            style={{ height: sheetSlot || swap.height || 300 }}
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
        )}
    </div>
  );
});
