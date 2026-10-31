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
import { countMediaNodes } from "@/components/editor/media/mediaSchema";
import { Loader2 } from "lucide-react";
import { RichComposer, type RichComposerPayload } from "@/components/composer/RichComposer";
import { entityParam } from "@/utils/entityUrl";

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
  const [hasMedia, setHasMedia] = useState(false);
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
      } else {
        // No channel in the URL (legacy /create link): fall back to the
        // board's default channel instead of creating an orphan thread.
        try {
          const channelsResponse = await fetch(`/api/v1/channels?board_id=eq.${data.id}&order=sort_order.asc&limit=50`);
          const channelsResult = await channelsResponse.json();
          const list = (channelsResult.data || []) as { id: string; is_default?: boolean }[];
          const fallback = list.find((c) => c.is_default) ?? list[0];
          if (fallback) setChannelId(fallback.id);
        } catch {
          // Creation stays possible; the thread just lands channel-less.
        }
      }

      // Restore an autosaved draft for this board.
      try {
        const raw = localStorage.getItem(draftKey(data.id));
        if (raw) {
          const draft = JSON.parse(raw) as Draft;
          if (draft?.title || draft?.contentJson || draft?.attachments?.length) {
            setTitle(draft.title || "");
            setContentJson(draft.contentJson ?? null);
            setHasMedia(countMediaNodes(draft.contentJson) > 0);
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

  // Closing returns to whatever is underneath (the board in overlay mode).
  // A bookmarked create URL has no history to go back to — fall back to the
  // board itself instead of a dead X.
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(slug ? `/g/${slug}` : "/g", { replace: true });
    }
  }, [navigate, slug]);

  const handlePublish = useCallback(
    async ({ json, text, attachments }: RichComposerPayload) => {
      if (!board) return;
      if (!title.trim() && attachments.length === 0) {
        toast.error("Введите заголовок или прикрепите фото");
        return;
      }
      // The body may be media-only — a bare photo posts needs neither
      // title nor text.
      if (!text.trim() && attachments.length === 0) {
        toast.error("Добавьте текст или медиафайл");
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
        navigate(`/g/${board.slug}/thread/${entityParam(threadData)}`);
      } catch (err) {
        console.error("CreateGomoThread error:", err);
        toast.error("Ошибка при публикации записи");
      }
    },
    [board, channelId, channelSlug, navigate, title],
  );

  if (loadingBoard) {
    // A translucent veil, not a solid screen: in overlay mode the board stays
    // visible underneath while it loads; on a direct visit it just dims the
    // layout behind the composer that is about to open.
    return (
      <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center">
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
      publishDisabled={!title.trim() && !hasMedia}
      onChange={({ json }) => {
        setContentJson(json);
        setHasMedia(countMediaNodes(json) > 0);
      }}
      onPublish={handlePublish}
      onClose={handleClose}
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
