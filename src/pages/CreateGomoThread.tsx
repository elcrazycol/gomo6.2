import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AttachmentUpload } from "@/components/AttachmentUpload";
import { AttachmentMeta } from "@/utils/mediaUpload";
import { Loader2 } from "lucide-react";

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
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    const loadBoard = async () => {
      setLoadingBoard(true);
      const { data } = await supabase
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

  const handleCreate = async () => {
    if (!board) return;
    if (!title.trim() || !content.trim()) {
      toast.error("Заполните заголовок и текст");
      return;
    }

    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      toast.error("Нужно войти в аккаунт");
      navigate("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("threads")
      .insert({
        board_id: board.id,
        user_id: user.id,
        title: title.trim(),
        content: content.trim(),
        image_url: imageUrl,
        attachments: attachments.length ? attachments : null,
        tags: selectedTags.length ? { gomosub_tags: selectedTags } : null
      })
      .select("id")
      .single();

    setCreating(false);
    if (error) {
      toast.error(error.message || "Ошибка при создании треда");
      return;
    }

    toast.success("Тред создан");
    navigate(`/g/${board.slug}/thread/${data.id}`);
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
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} placeholder="Текст треда" />
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
            <AttachmentUpload value={attachments} onChange={setAttachments} maxFiles={10} />
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
    </div>
  );
};

export default CreateGomoThread;
