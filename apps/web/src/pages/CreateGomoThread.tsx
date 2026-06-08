import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AttachmentUpload } from "@/components/AttachmentUpload";
import { AttachmentMeta } from "@/utils/mediaUpload";
import { Loader2, Smile, X } from "lucide-react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ImageGallery } from "@/components/ImageGallery";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";

type GomoBoard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  gomosub_tags: string[] | null;
};

const CreateGomoThread = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [creating, setCreating] = useState(false);
  const [board, setBoard] = useState<GomoBoard | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contentJson, setContentJson] = useState<unknown>(null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);

  // Adapter to match AttachmentUpload's expected onChange type
  const onAttachmentsChange = (attachments: AttachmentMeta[]) => {
    setAttachments(attachments);
  };
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const editorRef = useRef<GomoRichEditorHandle | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

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
      setLoadingBoard(false);
    };

    loadBoard();
  }, [navigate, slug]);

  const imageUrl = useMemo(
    () => attachments.find((att) => att.type === "image")?.url || null,
    [attachments]
  );

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

  const handleEmojiSelect = (emojiCode: string) => {
    editorRef.current?.focus();
    editorRef.current?.insertText(emojiCode);
  };

  const handleCreate = async () => {
    if (!board) return;
    if (!title.trim() || !content.trim()) {
      toast.error("Заполните заголовок и текст");
      return;
    }

    setCreating(true);
    try {
      // Use RPC backend API (not old PostgREST-style POST /api/v1/threads)
      const threadPayload: any = {
        board_id: board.id,
        title: title.trim(),
        content: content.trim(),
        content_json: contentJson,
        image_urls: imageUrl ? [imageUrl] : [],
        attachments: attachments.length ? attachments : null,
      };

      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("Нужно войти в аккаунт");
        navigate("/auth");
        return;
      }

      const response = await fetch('/api/rpc/create_thread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(threadPayload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        toast.error(errData.error || 'Ошибка при создании треда');
        return;
      }

      const responseData = await response.json();
      const threadData = responseData.data || responseData;
      if (!threadData?.id) {
        toast.error('Не удалось получить ID треда');
        return;
      }

      toast.success("Тред создан");
      navigate(`/g/${board.slug}/thread/${threadData.id}`);
    } catch (err) {
      console.error('CreateGomoThread error:', err);
      toast.error('Ошибка при создании треда');
    } finally {
      setCreating(false);
    }
  };

  if (loadingBoard) {
    return (
      <div className="max-w-3xl mx-auto p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Новый тред в g/{board?.slug}</CardTitle>
          <p className="text-sm text-muted-foreground">{board?.description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Заголовок</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Тема треда" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Текст</label>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <EmojiPicker onEmojiSelect={handleEmojiSelect} triggerRef={emojiButtonRef}>
                  <Button
                    ref={emojiButtonRef}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Эмодзи"
                  >
                    <Smile className="h-4 w-4" />
                  </Button>
                </EmojiPicker>
              </div>
              <GomoRichEditor
                ref={editorRef}
                contentJson={contentJson}
                legacyContent={content}
                onChange={({ json, text }) => {
                  setContentJson(json);
                  setContent(text);
                }}
                onSubmit={handleCreate}
                placeholder="Текст треда"
                minHeightClassName="min-h-[180px]"
              />
            </div>
          </div>

          {board?.gomosub_tags && board.gomosub_tags.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Теги этого g-саба</label>
              <div className="flex flex-wrap gap-2">
                {board.gomosub_tags.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <Badge
                      key={tag}
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag(tag)}
                    >
                      #{tag}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Вложения</label>
            <AttachmentUpload value={attachments} onChange={onAttachmentsChange} maxFiles={10} />
            {attachments.length > 0 && (
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                {attachments.map((att, index) => (
                  <div key={`${att.url}-${index}`} className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {att.type === "image" && (
                        <button type="button" onClick={() => openAttachmentEditor(imageAttachments.findIndex((img) => img.url === att.url))}>
                          <img src={att.url} alt={att.name} className="max-h-36 w-auto rounded-md object-cover" />
                        </button>
                      )}
                      {att.type === "video" && (
                        <video src={att.url} poster={att.poster} controls className="max-h-40 w-full rounded-md" />
                      )}
                      {att.type === "audio" && (
                        <audio src={att.url} controls className="w-full" />
                      )}
                      {att.type === "file" && (
                        <a href={att.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline break-all">
                          {att.name}
                        </a>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground truncate">
                        {att.name} · {formatSize(att.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeAttachment(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => navigate(`/g/${board?.slug}`)} className="w-full sm:w-auto">
              Назад
            </Button>
            <Button onClick={handleCreate} disabled={creating} className="w-full sm:w-auto">
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Создать тред
            </Button>
          </div>
        </CardContent>
      </Card>
      {showGallery && imageAttachments.length > 0 && (
        <ImageGallery
          images={imageAttachments.map((att) => att.url)}
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
