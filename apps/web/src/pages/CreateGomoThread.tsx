import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { uploadAttachments, type AttachmentMeta } from "@/utils/mediaUpload";
import {
  Loader2,
  Smile,
  X,
  Eye,
  PenLine,
  Paperclip,
  FileText,
  FileVideo2,
  Music,
} from "lucide-react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { RichContentRenderer } from "@/components/RichContentRenderer";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";

type GomoBoard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  gomosub_tags: string[] | null;
};

interface Draft {
  title: string;
  content: string;
  contentJson: unknown;
  attachments: AttachmentMeta[];
}

const DRAFT_PREFIX = "gomo6:composer-draft:";
const MAX_ATTACHMENTS = 10;

const draftKey = (boardId: string) => `${DRAFT_PREFIX}${boardId}`;

const CreateGomoThread = () => {
  const { slug, channelSlug } = useParams();
  const navigate = useNavigate();
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [creating, setCreating] = useState(false);
  const [board, setBoard] = useState<GomoBoard | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contentJson, setContentJson] = useState<unknown>(null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Publish button style — read once on mount (user picks it in Settings → Appearance).
  const [publishButtonStyle] = useState(getPublishButtonStyle);
  const [showPreview, setShowPreview] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const editorRef = useRef<GomoRichEditorHandle | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);

  // Touch: the emoji trigger swaps the soft keyboard for the panel (same
  // height, same slide) and back — Telegram-style, see useEmojiKeyboardSwap.
  const emojiSwap = useEmojiKeyboardSwap(editorRef);
  const { keyboardInset } = useMobileKeyboard();

  // Load board + resolve channel slug → id, then restore the draft (if any).
  useEffect(() => {
    const loadBoard = async () => {
      setLoadingBoard(true);
      const { data } = await api
        .from("boards")
        .select("id, slug, name, description, gomosub_tags")
        .eq("slug", slug)
        .eq("is_gomosub", true)
        .maybeSingle();

      if (!data) {
        toast.error("G-саб не найден");
        navigate("/g");
        return;
      }

      const tags = Array.isArray(data.gomosub_tags)
        ? data.gomosub_tags.filter((t): t is string => typeof t === "string")
        : [];

      setBoard({ ...data, gomosub_tags: tags });

      // If creating in a channel, resolve channel slug to ID
      if (channelSlug) {
        const channelsResponse = await fetch(`/api/v1/channels?board_id=eq.${data.id}&slug=eq.${channelSlug}`);
        const channelsResult = await channelsResponse.json();
        const channelData = channelsResult.data?.[0];
        if (channelData) {
          setChannelId(channelData.id);
        }
      }

      // Restore an autosaved draft for this board.
      try {
        const raw = localStorage.getItem(draftKey(data.id));
        if (raw) {
          const draft = JSON.parse(raw) as Draft;
          if (draft?.title || draft?.content || draft?.attachments?.length) {
            setTitle(draft.title || "");
            setContent(draft.content || "");
            setContentJson(draft.contentJson ?? null);
            setAttachments(draft.attachments || []);
            setRestoredDraft(true);
          }
        }
      } catch {
        // Corrupt draft — ignore.
      }

      setLoadingBoard(false);
    };

    loadBoard();
  }, [navigate, slug, channelSlug]);

  // Autosave the draft (debounced) once the board is known.
  useEffect(() => {
    if (!board) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const draft: Draft = { title, content, contentJson, attachments };
      try {
        localStorage.setItem(draftKey(board.id), JSON.stringify(draft));
      } catch {
        // Storage full — ignore, publishing still works.
      }
    }, 350);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [board, title, content, contentJson, attachments]);

  // Escape closes the composer (browser back also works) — unless the emoji
  // panel is up, where Escape belongs to the panel (closes it, keyboard back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emojiSwap.open) {
        e.preventDefault();
        navigate(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, emojiSwap.open]);

  // Emoji panel ↔ keyboard: the composer is bottom-anchored at --kb-inset, so
  // while the keyboard is up the toolbar floats right above it. The moment the
  // swap panel opens the keyboard dismisses and --kb-inset drops to 0 — if we
  // did nothing, the toolbar would fall to the screen bottom and the panel
  // would cover it. Instead the composer's bottom is lifted by the panel
  // height (same space the keyboard just vacated), so the toolbar never moves.
  // On close the override is removed and the global --kb-inset takes over:
  // a returning keyboard rides the composer back up with no React lag.
  useEffect(() => {
    const root = composerRootRef.current;
    if (!root) return;
    if (emojiSwap.open) {
      const lift = Math.max(emojiSwap.height, keyboardInset);
      root.style.setProperty("bottom", `${lift}px`);
    } else {
      root.style.removeProperty("bottom");
    }
  }, [emojiSwap.open, emojiSwap.height, keyboardInset]);

  const close = useCallback(() => navigate(-1), [navigate]);

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !creating;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const openAttachmentEditor = (imageAttachmentIndex: number) => {
    setGalleryIndex(imageAttachmentIndex);
    setShowGallery(true);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} КБ`;
    return `${(kb / 1024).toFixed(1)} МБ`;
  };

  const imageAttachments = useMemo(
    () => attachments.filter((att) => att.type === "image"),
    [attachments]
  );

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      toast.error(`Максимум ${MAX_ATTACHMENTS} файлов`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadAttachments(files, "content");
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      console.error("Attachment upload error", err);
      toast.error("Не удалось загрузить файлы");
    } finally {
      setUploading(false);
    }
  };

  const handleEmojiSelect = (data: { emojiId: string; packId: string; url: string; name: string }) => {
    if (emojiSwap.open) {
      // Panel replaced the keyboard: insert at the saved caret WITHOUT
      // refocusing, so the keyboard stays hidden and the user can keep
      // adding emojis.
      editorRef.current?.insertEmoji(data, { focus: false });
    } else {
      editorRef.current?.focus();
      editorRef.current?.insertEmoji(data);
    }
  };

  const handleCreate = async () => {
    if (!board) return;
    if (!title.trim() || !content.trim()) {
      toast.error("Заполните заголовок и текст");
      return;
    }

    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        board_id: board.id,
        title: title.trim(),
        content: content.trim(),
        content_json: contentJson,
        image_urls: imageAttachments.length ? imageAttachments.map((a) => a.url) : [],
        attachments: attachments.length ? attachments : null,
        ...(channelId ? { channel_id: channelId } : {}),
      };

      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("Нужно войти в аккаунт");
        navigate("/auth");
        return;
      }

      const response = await fetch("/api/rpc/create_thread", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        toast.error(errData.error || "Ошибка при публикации записи");
        return;
      }

      const responseData = await response.json();
      const threadData = responseData.data || responseData;
      if (!threadData?.id) {
        toast.error("Не удалось получить ID записи");
        return;
      }

      toast.success("Запись опубликована");
      try {
        localStorage.removeItem(draftKey(board.id));
      } catch {
        // ignore
      }
      // Raw RPC write bypasses query-builder — drop threads/boards GET cache.
      invalidateByPrefix("/api/v1/threads");
      invalidateByPrefix("/api/v1/boards");
      // Replace the create-page history entry with the sub's board page in the
      // channel the post was created in, so pressing Back lands on the sub
      // (with the new post visible) instead of reopening the composer.
      const backPath = channelSlug ? `/g/${board.slug}/c/${channelSlug}` : `/g/${board.slug}`;
      navigate(backPath, { replace: true });
      navigate(`/g/${board.slug}/thread/${threadData.id}`);
    } catch (err) {
      console.error("CreateGomoThread error:", err);
      toast.error("Ошибка при публикации записи");
    } finally {
      setCreating(false);
    }
  };

  const renderAttachmentsGrid = (readonly: boolean) => {
    if (attachments.length === 0) return null;
    return (
      <div className="grid grid-cols-3 gap-2 max-h-[22dvh] overflow-y-auto pr-0.5">
        {attachments.map((att, index) => {
          const removeBtn = (
            <button
              type="button"
              onClick={() => removeAttachment(index)}
              aria-label="Удалить вложение"
              className="absolute top-1 right-1 z-10 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center active:scale-90 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          );
          if (att.type === "image") {
            const imgIdx = imageAttachments.findIndex((img) => img.url === att.url);
            return (
              <div key={`${att.url}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-border/60 bg-muted/40">
                {readonly ? (
                  <img src={att.url} alt={att.name || ""} className="w-full h-full object-cover" />
                ) : (
                  <button type="button" className="w-full h-full" onClick={() => openAttachmentEditor(imgIdx)}>
                    <img src={att.url} alt={att.name || ""} className="w-full h-full object-cover" />
                  </button>
                )}
                {!readonly && removeBtn}
              </div>
            );
          }
          if (att.type === "video") {
            return (
              <div key={`${att.url}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-border/60 bg-muted/40">
                {att.poster ? (
                  <img src={att.poster} alt={att.name || ""} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileVideo2 className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                {!readonly && removeBtn}
              </div>
            );
          }
          return (
            <div
              key={`${att.url}-${index}`}
              className={`relative col-span-3 flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 ${readonly ? "" : ""}`}
            >
              <div className="w-9 h-9 rounded-md bg-background/80 flex items-center justify-center shrink-0">
                {att.type === "audio" ? (
                  <Music className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{att.name || "Файл"}</p>
                <p className="text-[11px] text-muted-foreground">{formatSize(att.size)}</p>
              </div>
              {!readonly && removeBtn}
            </div>
          );
        })}
      </div>
    );
  };

  if (loadingBoard) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!board) return null;

  return (
    <div className="fixed inset-0 z-50 md:bg-black/50 md:backdrop-blur-[2px] md:flex md:items-center md:justify-center">
      <div
        ref={composerRootRef}
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 top-0 bottom-[var(--kb-inset)] md:static flex flex-col w-full md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-2xl md:border md:border-border/60 md:shadow-2xl bg-background md:bg-card overflow-hidden animate-in slide-in-from-bottom-full md:slide-in-from-bottom-8 duration-300 ease-out"
      >
        {/* Header — close, destination, publish */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border/60 shrink-0">
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="p-2 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground active:scale-95 transition"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 text-center px-1">
            <span className="text-sm font-semibold text-primary truncate">g/{board.slug}</span>
            {channelSlug && <span className="text-sm text-muted-foreground truncate"> · #{channelSlug}</span>}
            {restoredDraft && (
              <span className="ml-2 text-[11px] text-muted-foreground/70 whitespace-nowrap">черновик</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-muted-foreground"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <PenLine className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />}
            {showPreview ? "Редактировать" : "Предпросмотр"}
          </Button>
        </div>

        {/* Title */}
        <div className="px-4 pt-2.5 shrink-0">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            placeholder="Заголовок"
            autoFocus
            className="border-0 bg-transparent px-0 text-lg sm:text-xl font-semibold focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-0 shadow-none"
          />
          {title.length > 0 && (
            <div className={`text-right text-[11px] pr-1 -mt-0.5 ${title.length > 130 ? "text-destructive" : "text-muted-foreground"}`}>
              {title.length}/140
            </div>
          )}
        </div>

        {/* Sub tags — compact chips */}
        {board.gomosub_tags && board.gomosub_tags.length > 0 && (
          <div className="px-4 pb-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {board.gomosub_tags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  variant={active ? "default" : "outline"}
                  className={`shrink-0 cursor-pointer select-none ${active ? "" : "text-muted-foreground"}`}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Editor / live preview */}
        <div
          className="flex-1 min-h-0 px-4 pb-2 overflow-y-auto"
          onClick={(e) => {
            if (showPreview) return;
            // The tiptap editable is smaller than this pane — clicking the
            // dead space below/around it should focus the editor, not do
            // nothing.
            const target = e.target as HTMLElement;
            if (target.closest("[contenteditable]")) return;
            if (target.closest("button, a, input, [data-radix-popper-content-wrapper]")) return;
            editorRef.current?.focus();
          }}
        >
          {showPreview ? (
            <div className="py-2 pb-4">
              {title.trim() && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
              {contentJson ? (
                <RichContentRenderer contentJson={contentJson} />
              ) : (
                <p className="text-sm sm:text-base text-foreground/90 whitespace-pre-wrap break-words">{content}</p>
              )}
              {renderAttachmentsGrid(true)}
              {!title.trim() && !content && (
                <p className="text-sm text-muted-foreground">Пока пусто — начните писать.</p>
              )}
            </div>
          ) : (
            <GomoRichEditor
              ref={editorRef}
              contentJson={contentJson}
              legacyContent={content}
              onChange={({ json, text }) => {
                setContentJson(json);
                setContent(text);
              }}
              onSubmit={handleCreate}
              placeholder="Текст записи…"
              minHeightClassName="min-h-[160px]"
              maxHeightClassName="max-h-full"
            />
          )}
        </div>

        {/* Attachments grid */}
        {attachments.length > 0 && !showPreview && (
          <div className="px-4 pb-2 shrink-0">{renderAttachmentsGrid(false)}</div>
        )}

        {/* Toolbar */}
        <div className="px-2 py-1.5 border-t border-border/60 flex items-center gap-0.5 shrink-0">
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            triggerRef={emojiButtonRef}
            keyboardSwap
            swapOpen={emojiSwap.open}
            swapHeight={emojiSwap.height}
            onSwapToggle={emojiSwap.toggle}
            onSwapClose={() => emojiSwap.closePanel(false)}
          >
            <Button
              ref={emojiButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground"
              title="Эмодзи"
            >
              <Smile className="h-5 w-5" />
            </Button>
          </EmojiPicker>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            title="Вложения"
            disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="composer-file-input"
            onChange={handleFiles}
          />
          <div className="flex-1" />
          <PublishButton style={publishButtonStyle} creating={creating} disabled={!canSubmit} onClick={handleCreate} />
        </div>
      </div>

      {showGallery && imageAttachments.length > 0 && (
        <Lightbox
          items={imageAttachments.map((att) => ({ url: att.url, type: "image", name: att.name || "Фото", mime: "image/*" } as LightboxItem))}
          initialIndex={galleryIndex}
          onClose={() => setShowGallery(false)}
          onEditImage={(idx, dataUrl) => {
            setAttachments((prev) => {
              let imageIdx = -1;
              return prev.map((att) => {
                if (att.type === "image") {
                  imageIdx += 1;
                  if (imageIdx === idx) {
                    return { ...att, url: dataUrl };
                  }
                }
                return att;
              });
            });
          }}
        />
      )}
    </div>
  );
};

export default CreateGomoThread;
