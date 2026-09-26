// g-sub (community) post composer. Thin wrapper around the shared
// RichComposer: the board/channel resolution, autosaved draft (title + body)
// and the create_thread submission live here; everything about editing is the
// same machine the profile wall and global topics use.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { MediaAttachment } from "@/components/editor/media/mediaSchema";
import { Loader2 } from "lucide-react";
import { RichComposer, type RichComposerPayload } from "@/components/composer/RichComposer";

type GomoBoard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  gomosub_tags: string[] | null;
};

interface Draft {
  title: string;
  contentJson: unknown;
  attachments: MediaAttachment[];
}

const DRAFT_PREFIX = "gomo6:composer-draft:";

const draftKey = (boardId: string) => `${DRAFT_PREFIX}${boardId}`;

const CreateGomoThread = () => {
  const { slug, channelSlug } = useParams();
  const navigate = useNavigate();
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [board, setBoard] = useState<GomoBoard | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contentJson, setContentJson] = useState<unknown>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [restoredDraft, setRestoredDraft] = useState<Draft | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      if (channelSlug) {
        const channelsResponse = await fetch(`/api/v1/channels?board_id=eq.${data.id}&slug=eq.${channelSlug}`);
        const channelsResult = await channelsResponse.json();
        const channelData = channelsResult.data?.[0];
        if (channelData) setChannelId(channelData.id);
      }

      // Restore an autosaved draft for this board.
      try {
        const raw = localStorage.getItem(draftKey(data.id));
        if (raw) {
          const draft = JSON.parse(raw) as Draft;
          if (draft?.title || draft?.contentJson || draft?.attachments?.length) {
            setTitle(draft.title || "");
            setContentJson(draft.contentJson ?? null);
            setRestoredDraft({
              title: draft.title || "",
              contentJson: draft.contentJson ?? null,
              attachments: draft.attachments || [],
            });
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
      const draft: Draft = { title, contentJson, attachments: [] };
      try {
        localStorage.setItem(draftKey(board.id), JSON.stringify(draft));
      } catch {
        // Storage full — ignore, publishing still works.
      }
    }, 350);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [board, title, contentJson]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handlePublish = useCallback(
    async ({ json, text, attachments }: RichComposerPayload) => {
      if (!board) return;
      if (!title.trim() || !text.trim()) {
        toast.error("Заполните заголовок и текст");
        return;
      }

      const imageAttachments = attachments.filter((att) => att.type === "image");
      const payload: Record<string, unknown> = {
        board_id: board.id,
        title: title.trim(),
        content: text.trim(),
        content_json: json,
        image_urls: imageAttachments.map((a) => a.url),
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

      try {
        const response = await fetch("/api/rpc/create_thread", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
        invalidateByPrefix("/api/v1/threads");
        invalidateByPrefix("/api/v1/boards");
        const backPath = channelSlug ? `/g/${board.slug}/c/${channelSlug}` : `/g/${board.slug}`;
        navigate(backPath, { replace: true });
        navigate(`/g/${board.slug}/thread/${threadData.id}`);
      } catch (err) {
        console.error("CreateGomoThread error:", err);
        toast.error("Ошибка при публикации записи");
      }
    },
    [board, channelId, channelSlug, navigate, title],
  );

  if (loadingBoard) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!board) return null;

  return (
    <RichComposer
      key={board.id}
      bucket="content"
      headerLabel={
        <>
          <span className="text-primary">g/{board.slug}</span>
          {channelSlug && <span className="text-muted-foreground"> · #{channelSlug}</span>}
        </>
      }
      placeholder="Текст записи…"
      headerMeta={restoredDraft ? "черновик" : undefined}
      initialContentJson={restoredDraft?.contentJson ?? null}
      initialAttachments={restoredDraft?.attachments ?? []}
      publishDisabled={!title.trim()}
      onChange={({ json }) => setContentJson(json)}
      onPublish={handlePublish}
      onClose={() => navigate(-1)}
    >
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
    </RichComposer>
  );
};

export default CreateGomoThread;
