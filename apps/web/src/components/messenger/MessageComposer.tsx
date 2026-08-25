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
/** Minimum height a visible soft keyboard covers. Below this a layout change
 *  is URL-bar / viewport noise, not a keyboard — the release decisions on the
 *  keyboard-return read the LIVE geometry and use this to tell a (still)
 *  rising keyboard from "no keyboard came" (mirrors mobileKeyboard's
 *  OPEN_THRESHOLD_PX). */
const KB_VISIBLE_PX = 60;
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
  // True once the window-collapse engine (Firefox iOS) has been observed for
  // this composer mount: in such a session the hook can never MEASURE the
  // keyboard (the vv-delta stays 0) — swap.height is always a provisional
  // guess and must never enter the slot floor. The shrink, measured at the
  // open moment, is the real height and becomes the floor. The flag survives
  // across sessions (the device's engine doesn't change).
  const sessionShrinkRef = useRef(false);
  // The TOP edge (window coords) the sheet/panel is pinned to — the keyboard's
  // top in the full window. Mirrors the sheetTop state for use inside the lift
  // effect without re-running it (the effect writes the state).
  const sheetTopRef = useRef(0);
  // The window's FULL height with the keyboard dismissed — the max innerHeight
  // seen since mount. On Firefox iOS the keyboard collapses innerHeight itself,
  // so baseline − innerHeight IS the keyboard's height (the vv-delta is 0
  // there). On constant-window engines the shrink is 0 and the vv-based
  // keyboardInset owns the geometry.
  const baselineHeightRef = useRef<number | null>(null);
  // Fallback release for a held lift on a refocus-close whose keyboard never
  // returns (focus without keyboard), and the settlement tracker for the
  // keyboard-return handoff (see the lift effect).
  const liftHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevInsetRef = useRef<number | null>(null);
  // Bounded confirmation timer for the keyboard-return handoff (see the
  // refocus branch): fires only when the settlement wasn't confirmed by a
  // second, equal report.
  const settleConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Frame-level window follow for the window-collapse engine (Firefox iOS):
  // the effect's own runs depend on viewport-event delivery, which can be
  // sparse or absent during the keyboard rise — the stale local then drifts
  // the composer off the sheet top and the first collapsed event snaps it
  // back. The rAF follow reads innerHeight every frame, so the composer stays
  // EXACTLY at the sheet top for every frame of the ride (see
  // windowFollowStart in the close branch).
  const windowFollowRafRef = useRef<number | null>(null);
  // Deadline for the follow: if the window has not collapsed to the sheet top
  // within LIFT_HOLD_FALLBACK_MS, the keyboard is not coming (focus without a
  // keyboard) — release the override.
  const windowFollowDeadlineRef = useRef(0);
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
  // Live mirror of the swap's open state for the sheet-lift machinery that
  // runs OUTSIDE React's render cycle (the window-resize handler and the rAF
  // window-follow): while a sheet session is up, the session owns the
  // composer's lift, and that ownership must be visible to those paths
  // without re-subscribing them to re-renders.
  const swapOpenRef = useRef(swap.open);
  swapOpenRef.current = swap.open;

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
  const anchorSheetLift = useCallback((forcedInset?: number) => {
    let inset = forcedInset ?? getMobileKeyboardState().keyboardInset;
    // Firefox iOS zeroes keyboardInset synchronously on blur, before the
    // panel even starts rising. Fallback: if inset is already 0 but the visual
    // viewport hasn't grown back yet, compute the delta directly — the keyboard
    // is still physically covering the screen.
    if (inset < 60 && typeof window !== "undefined" && window.visualViewport) {
      const vv = window.visualViewport;
      const delta = window.innerHeight - vv.height;
      if (delta >= 60) {
        inset = Math.round(delta - (vv.offsetTop || 0));
        if (import.meta.env.DEV) {
          console.log("[anchorSheetLift] fallback via visualViewport", { delta, offsetTop: vv.offsetTop, computed: inset });
        }
      }
    }
    // Second Firefox-specific source: there the keyboard collapses innerHeight
    // itself (vv moves together, the vv-delta stays 0 and the fallback above
    // computes 0). The keyboard's height is exactly baseline − innerHeight —
    // a real measured value, not the provisional guess. On constant-window
    // engines the shrink is 0 and keyboardInset (or the vv fallback) wins.
    if (inset < 60 && typeof window !== "undefined" && baselineHeightRef.current !== null) {
      const shrink = Math.max(0, baselineHeightRef.current - window.innerHeight);
      if (shrink >= 60) {
        inset = Math.max(inset, shrink);
      }
    }
    if (inset < 60) return; // no real keyboard above the composer
    const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
    if (!panel) return;
    const current = parseFloat(panel.style.getPropertyValue("--kb-inset")) || 0;
    if (import.meta.env.DEV) {
      console.log("[anchorSheetLift]", { inset, current, willSet: inset > current });
    }
    if (inset > current) panel.style.setProperty("--kb-inset", `${inset}px`);
  }, []);

  // Trigger semantics for the shared keyboard slot: re-tap on the open
  // sheet's own trigger closes it (keyboard returns); tapping the OTHER
  // trigger while a sheet is up switches the slot's content without
  // summoning the keyboard.
  const handleEmojiTrigger = useCallback(() => {
    // A closing attach sheet must not linger over the emoji panel.
    setAttachClosing(false);
    // Snapshot the keyboard inset BEFORE any blur can happen — Firefox iOS may
    // zero it synchronously in the blur, before anchorSheetLift reads it.
    const liveInset = getMobileKeyboardState().keyboardInset;
    anchorSheetLift(liveInset);
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
    // Snapshot the keyboard inset BEFORE any blur can happen — Firefox iOS may
    // zero it synchronously in the blur, before anchorSheetLift reads it.
    const liveInset = getMobileKeyboardState().keyboardInset;
    anchorSheetLift(liveInset);
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
  // space, banners…) must not move focus AWAY: the browser would blur the
  // editor and on mobile the soft keyboard flies away as a result
  // (mobileKeyboard's handleFocusOut starts the eased composer descent on
  // blur). preventDefault on mousedown cancels the browser's default focus
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

  const stopWindowFollow = useCallback(() => {
    if (windowFollowRafRef.current !== null) {
      cancelAnimationFrame(windowFollowRafRef.current);
      windowFollowRafRef.current = null;
    }
  }, []);

  // The keyboard's live footprint, read DIRECTLY from the platform instead of
  // the event-fed mobileKeyboard state: Firefox can raise (or dismiss) the
  // keyboard with few or no visual-viewport events at all — the release
  // decisions below must never wait on reports that may arrive late or never.
  // Returns both engines' signals: the visual-viewport inset (constant-window
  // engines: innerHeight stays put, the keyboard shows as a vv shrink) and
  // the window's collapse below its peak (window-collapse engines — Firefox:
  // innerHeight itself shrinks WITH the keyboard, the vv-delta stays 0).
  const readLiveKeyboardEvidence = () => {
    const winH = typeof window !== "undefined" ? window.innerHeight : 0;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const vvInset = vv ? Math.max(0, Math.round(winH - vv.height) - (vv.offsetTop || 0)) : 0;
    const windowShrink =
      baselineHeightRef.current !== null ? Math.max(0, baselineHeightRef.current - winH) : 0;
    return { vvInset, windowShrink };
  };

  const startWindowFollow = useCallback(() => {
    if (windowFollowRafRef.current !== null) return; // already following
    windowFollowDeadlineRef.current = Date.now() + LIFT_HOLD_FALLBACK_MS;
    const step = () => {
      windowFollowRafRef.current = null;
      const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
      if (!panel) return;
      // A live sheet session owns the lift — the swap-open effect branch plus
      // the synchronous resize handler keep it exact. The follow is a
      // keyboard-RETURN ride only; its deadline-based release must never fire
      // while a sheet is still up, or it drops the composer under the open
      // panel ~LIFT_HOLD_FALLBACK_MS after any resize armed it (the Firefox
      // attach↔emoji "composer falls to the bottom": Firefox collapses
      // innerHeight with the keyboard, so the dismissal resizes while the
      // sheet is open armed the release).
      if (swapOpenRef.current) return;
      if (Date.now() > windowFollowDeadlineRef.current) {
        // The deadline is only a "focus got no keyboard" fallback. If the
        // window is STILL collapsed below its peak, the keyboard is (still)
        // rising — keep riding to the bottom-out instead of dropping the lift
        // mid-raise (which sinks the composer off the sheet top and snaps it
        // back once the collapse completes — the return blink). Only a window
        // that never collapsed means no keyboard is coming: release.
        const { windowShrink } = readLiveKeyboardEvidence();
        if (windowShrink < KB_VISIBLE_PX) {
          panel.style.removeProperty("--kb-inset");
          return;
        }
      }
      const winH = typeof window !== "undefined" ? window.innerHeight : 0;
      const lift = Math.max(0, Math.round(winH) - sheetTopRef.current);
      if (lift > 0) {
        panel.style.setProperty("--kb-inset", `${lift}px`);
        windowFollowRafRef.current = requestAnimationFrame(step);
      } else {
        // Collapsed to the sheet top — the composer is seated on the risen
        // keyboard; nothing left to hold.
        panel.style.removeProperty("--kb-inset");
      }
    };
    windowFollowRafRef.current = requestAnimationFrame(step);
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
    const winH = typeof window !== "undefined" ? window.innerHeight : 0;
    // The window's FULL height (keyboard dismissed). Engines differ in HOW the
    // keyboard occupies the screen: Safari/Chrome keep innerHeight constant and
    // the keyboard shows as the visual-viewport delta; Firefox iOS collapses
    // innerHeight WITH the keyboard (the vv moves together, delta stays 0) —
    // there the keyboard's height is exactly baseline − innerHeight.
    if (baselineHeightRef.current === null || winH > baselineHeightRef.current) {
      baselineHeightRef.current = winH;
    }
    const windowShrink = winH > 0 && baselineHeightRef.current !== null ? baselineHeightRef.current - winH : 0;
    if (swap.open) {
      // Fresh session: the keyboard-return settlement tracking starts clean.
      prevInsetRef.current = null;
      if (settleConfirmTimerRef.current !== null) {
        clearTimeout(settleConfirmTimerRef.current);
        settleConfirmTimerRef.current = null;
      }
      const delta = Math.round(winH - viewportHeight);
      let slot: number;
      if (sessionShrinkRef.current || windowShrink > 0) {
        // Window-collapse engine (Firefox iOS): the shrink is the ONLY real
        // measurement of the keyboard (the vv-delta stays 0), so the floor is
        // fed from it — measured at the open, it's the full keyboard height,
        // stable across sessions, and the provisional guess never enters.
        // Re-runs while the window has grown back measure 0 and leave the
        // floor untouched (the sheet keeps the open moment's height).
        if (windowShrink > 0) sessionShrinkRef.current = true;
        const measured = Math.max(windowShrink, keyboardInset, delta);
        if (measured > sheetSlotRef.current) sheetSlotRef.current = measured;
        slot = sheetSlotRef.current;
      } else {
        // Constant-window engine: keyboardInset/delta are the real captures;
        // swap.height is the real pre-blur snapshot. The slot NEVER shrinks
        // across sessions: a second open can capture the keyboard mid-rise (a
        // fragment of its height, e.g. right after a refocus-close), which
        // would shrink the panel; the previous slot is the stable floor. The
        // keyboard height is device-stable, so the floor only yields to a
        // genuinely taller keyboard.
        const candidate = Math.max(swap.height, keyboardInset, delta);
        if (candidate > sheetSlotRef.current) sheetSlotRef.current = candidate;
        slot = sheetSlotRef.current;
      }
      if (sheetSlot !== slot) setSheetSlot(slot);
      // Pin the PANEL by its TOP edge instead of bottom: at open the keyboard
      // is still dismissing and the window still collapsed (or the window is
      // constant) — the keyboard's top edge is stable in screen space, so a
      // top-pinned panel stays glued there while the window grows/shrinks
      // around it, instead of riding the resize (grey gap over the messages,
      // "panel flies up" on return). The baseline (the full window height) is
      // stable, so the top does not change across effect re-runs.
      const topVal = Math.max(0, Math.round(baselineHeightRef.current ?? winH) - slot);
      sheetTopRef.current = topVal;
      // React bails out of the re-render when the value is unchanged, so no
      // dom guard or dependency is needed.
      setSheetTop(topVal);
      if (windowShrink > 0 || sessionShrinkRef.current) {
        // Window-engine (Firefox iOS): the composer already sits at its seat —
        // the keyboard's top (innerHeight when the keyboard is up = sheetTop
        // when it isn't). The lift only has to compensate the window's
        // growth/collapse: lift = max(0, innerHeight − sheetTop). The composer
        // therefore NEVER moves: no anchor fragment to mis-measure (the "1 in
        // 3-4" drop under the panel), no glide, no stale hold.
        const lift = Math.max(0, Math.round(winH) - topVal);
        if (lift > 0) {
          chatPanel.style.setProperty("--kb-inset", `${lift}px`);
        } else {
          chatPanel.style.removeProperty("--kb-inset");
        }
        return;
      }
      // Constant-window engine: the keyboard is still dismissing (and the URL
      // bar still expanded) when the sheet first opens — slapping the FULL slot
      // on the composer in one frame makes it jump (teleport) above its
      // previous keyboard-top seat, then settle when the bar collapses. Glide
      // from the keyboard position up to the slot in sync with the sheet's
      // rise instead.
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
    // Firefox-style return: the WINDOW itself collapses as the keyboard opens
    // (innerHeight shrinks together with the visual viewport, the vv-delta
    // stays 0 and the keyboard is invisible to the mobileKeyboard). The
    // keyboard's top = the window's bottom = sheetTop when collapsed. The
    // composer is glued to the sheet's top edge, so its lift is
    // max(0, innerHeight − sheetTop): it eases from the slot down to 0 as the
    // window collapses, holding the composer in place for the whole ride —
    // no stale hold, no abrupt drop.
    //
    // The effect, however, only runs on viewport-event ticks (keyboardInset /
    // viewportHeight state updates), and Firefox can deliver the keyboard
    // rise with few or ZERO such events: the local then goes stale at the old
    // lift, the composer drifts off the sheet top as the window collapses,
    // and the first (full-collapse) event computes lift 0 and SNAPS it back —
    // the "composer teleports to the bottom, then the keyboard catches up".
    // A rAF follow reads innerHeight every frame instead: the composer stays
    // EXACTLY at the sheet top for every frame, regardless of event delivery,
    // and releases the override the moment the window bottoms out there.
    // On constant-window engines the shrink stays 0, sessionShrinkRef stays
    // false and this branch never fires — the vv-based tracking below owns
    // that path.
    if (sessionShrinkRef.current && typeof document !== "undefined" && isEditableElement(document.activeElement)) {
      if (parseFloat(chatPanel.style.getPropertyValue("--kb-inset")) > 0) {
        startWindowFollow();
      }
      return;
    }
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
            const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
            if (!panel) return;
            if ((parseFloat(panel.style.getPropertyValue("--kb-inset")) || 0) <= 0) return;
            // The 800ms deadline is only a "focus got no keyboard" fallback.
            // Firefox can raise the keyboard WITHOUT delivering its inset
            // reports to this effect in time (one late event, or none until it
            // settles) — a blind release here drops the composer to the bottom
            // under the still-rising keyboard and the late report snaps it back
            // up (the "composer falls under the keyboard, then jumps back"
            // blink). Read the LIVE geometry instead: if the keyboard is
            // visibly up — as a visual-viewport inset (constant-window engines)
            // or as a window collapse (window-engine, where the vv-delta stays
            // 0 and the inset is invisible to this state) — keep the hold and
            // pin the composer to its live seat; the report path then hands off
            // seamlessly the moment it catches up.
            const { vvInset, windowShrink } = readLiveKeyboardEvidence();
            if (windowShrink >= KB_VISIBLE_PX) {
              // Window-engine return: the seat is innerHeight − sheetTop,
              // riding the collapse down to 0. Hand it to the per-frame follow
              // so the ride stays frame-smooth, not an 800ms-staircase.
              const seat = Math.max(0, Math.round(window.innerHeight) - sheetTopRef.current);
              if (seat > 0) {
                panel.style.setProperty("--kb-inset", `${seat}px`);
                startWindowFollow();
              } else {
                panel.style.removeProperty("--kb-inset");
              }
              return;
            }
            if (vvInset >= KB_VISIBLE_PX) {
              // Constant-window return: hold the composer at the sheet's top
              // while the keyboard rises to it. The two-equal-reports handoff
              // releases it without movement once the reports catch up.
              return;
            }
            // No keyboard anywhere — plain focus (hardware keyboard / desktop
            // narrow window): the lift was never going to be replaced.
            panel.style.removeProperty("--kb-inset");
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
      //
      // Ceiling: never hold the composer above the maximum known keyboard slot
      // (sheetSlotRef) — Firefox iOS can spike transiently ABOVE the real
      // keyboard height; capping at the slot prevents the composer from flying
      // up on those spikes.
      const ceiling = sheetSlotRef.current > 0 ? sheetSlotRef.current : held;
      if (keyboardInset > ceiling) {
        if (import.meta.env.DEV) {
          console.log("[refocus] ceiling applied", { keyboardInset, ceiling, held });
        }
        chatPanel.style.setProperty("--kb-inset", `${ceiling}px`);
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
  }, [swap.open, swap.height, keyboardInset, viewportHeight, sheetSlot, stopEmojiGlide, startWindowFollow]);

  // Synchronous event path for the window-engine (Firefox iOS) ride: the
  // keyboard's rise can stall the page's rAF callbacks (the system animation
  // beats the page's frames) or ship few/no visualViewport events, so even the
  // rAF follow can miss frames of the collapse — the stale local then drifts
  // the composer off the sheet top and the first event snaps it back. The
  // window/visualViewport resize events fire per re-layout while the keyboard
  // animates; write the lift SYNCHRONOUSLY in the handler (no frame
  // scheduling), so the composer is glued to the sheet top regardless of how
  // the frames land. Gated to the window-collapse engine and an ACTIVE lift
  // (local > 0): a keyboard dismissed outside a sheet session never moves
  // anything, and the open/switch/anchor writes all use the same formula, so
  // this never fights them.
  useEffect(() => {
    const onResize = () => {
      if (!sessionShrinkRef.current) return;
      const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
      if (!panel) return;
      if ((parseFloat(panel.style.getPropertyValue("--kb-inset")) || 0) <= 0) return;
      const winH = typeof window !== "undefined" ? window.innerHeight : 0;
      const lift = Math.max(0, Math.round(winH) - sheetTopRef.current);
      if (lift > 0) {
        panel.style.setProperty("--kb-inset", `${lift}px`);
        // A sheet session keeps its own lift (the swap-open effect branch +
        // this synchronous write): arming the window-follow here would fire
        // its deadline-based release ~LIFT_HOLD_FALLBACK_MS later and drop
        // the composer under the still-open sheet on the window-collapse
        // engine (the Firefox attach↔emoji drop). The follow belongs to the
        // keyboard-RETURN ride only — the swap-closed branch owns it.
        if (!swapOpenRef.current) startWindowFollow();
      } else {
        panel.style.removeProperty("--kb-inset");
      }
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [startWindowFollow]);

  // iOS pans the document when the soft keyboard opens/closes and an input is
  // focused: the visual viewport shrinks/grows, the browser scrolls the layout
  // viewport to "reveal" the input, and the whole `position: fixed` messenger
  // shell (fixed to the LAYOUT viewport) rides the pan — header drifting, the
  // composer and the sheet "flying up" then teleporting back. mobileKeyboard's
  // own pin runs only while ITS state reports the keyboard open — Firefox iOS
  // reports isOpen false at exactly the wrong moments (inset zeroed
  // synchronously on blur; coarse/late reports on return), so the sheet
  // session must pin independently: while a sheet is up OR while the sheet
  // machinery owns the lift (local --kb-inset > 0 — set by the anchor BEFORE
  // the blur, kept through the hold/handoff, removed only once the keyboard
  // has settled back). Cost: one scrollY read per frame; the write only when
  // the browser actually pans.
  useEffect(() => {
    if (!isTouch) return;
    let raf = 0;
    const step = () => {
      const panel = rootRef.current?.closest<HTMLElement>(".chat-panel");
      const localLift = panel ? parseFloat(panel.style.getPropertyValue("--kb-inset")) || 0 : 0;
      if ((swap.open || localLift > 0) && (window.scrollY !== 0 || window.scrollX !== 0)) {
        window.scrollTo(0, 0);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isTouch, swap.open]);

  // DEV-only diagnostics strip: live keyboard-geometry numbers pinned to the
  // screen (visualViewport vs state vs the composer's local lift). The whole
  // sheet↔keyboard choreography depends on values that cannot be reproduced in
  // jsdom — on-device recordings with these numbers show exactly what the
  // engine reports at the moment of a jump. Visible in dev builds, and on any
  // build when localStorage "kb-diag" === "1" (set it from the console, or via
  // Safari → Develop → device → Firefox, then reload).
  useEffect(() => {
    const enabled =
      import.meta.env.DEV ||
      (typeof localStorage !== "undefined" && localStorage.getItem("kb-diag") === "1");
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
        `local:${local} base:${baselineHeightRef.current ?? "—"} shrink:${baselineHeightRef.current !== null && typeof window !== "undefined" ? Math.max(0, baselineHeightRef.current - window.innerHeight) : 0} follow:${windowFollowRafRef.current !== null ? 1 : 0}`,
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

  // Clean up the local override, the held-lift timer and any in-flight glide on
  // unmount.
  useEffect(() => () => {
    stopEmojiGlide();
    stopWindowFollow();
    if (liftHoldTimerRef.current !== null) {
      clearTimeout(liftHoldTimerRef.current);
      liftHoldTimerRef.current = null;
    }
    if (settleConfirmTimerRef.current !== null) {
      clearTimeout(settleConfirmTimerRef.current);
      settleConfirmTimerRef.current = null;
    }
    rootRef.current?.closest<HTMLElement>(".chat-panel")?.style.removeProperty("--kb-inset");
  }, [stopEmojiGlide, stopWindowFollow]);

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
            swapTop={sheetTop}
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
        )}
    </div>
  );
});
