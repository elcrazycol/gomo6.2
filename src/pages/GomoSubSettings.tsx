import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImageUpload } from "@/components/ImageUpload";
import { Loader2, Save, Settings } from "lucide-react";
import { toast } from "sonner";
import { renderPreviewContent } from "@/utils/emojiUtils";

const GomoSubSettings = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    rules_markdown: "",
    cover_image_url: "",
    gomosub_tags: [] as string[]
  });
  const coverImages = useMemo(() => (form.cover_image_url ? [form.cover_image_url] : []), [form.cover_image_url]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: board } = await supabase
        .from("boards")
        .select("id, name, description, rules_markdown, cover_image_url, owner_id, gomosub_tags, is_gomosub")
        .eq("slug", slug)
        .eq("is_gomosub", true)
        .maybeSingle();

      if (!board) {
        toast.error("G-саб не найден");
        navigate("/g");
        return;
      }

      if (board.owner_id !== user.id) {
        toast.error("Только создатель может менять настройки");
        navigate(`/g/${slug}`);
        return;
      }

      const tags = Array.isArray(board.gomosub_tags)
        ? board.gomosub_tags.filter((t): t is string => typeof t === "string")
        : [];

      setIsOwner(true);
      setForm({
        id: board.id,
        name: board.name || "",
        description: board.description || "",
        rules_markdown: board.rules_markdown || "",
        cover_image_url: board.cover_image_url || "",
        gomosub_tags: tags
      });
      setLoading(false);
    };

    load();
  }, [navigate, slug]);

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (form.gomosub_tags.includes(tag)) {
      toast.error("Такой тег уже добавлен");
      return;
    }
    if (form.gomosub_tags.length >= 20) {
      toast.error("Максимум 20 кастомных тегов");
      return;
    }
    setForm((prev) => ({ ...prev, gomosub_tags: [...prev.gomosub_tags, tag] }));
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setForm((prev) => ({ ...prev, gomosub_tags: prev.gomosub_tags.filter((t) => t !== tag) }));
  };

  const handleSave = async () => {
    if (!isOwner) return;
    if (!form.name.trim()) {
      toast.error("Название обязательно");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Описание обязательно");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("boards")
      .update({
        name: form.name.trim(),
        description: form.description.trim(),
        rules_markdown: form.rules_markdown.trim() || null,
        cover_image_url: form.cover_image_url || null,
        gomosub_tags: form.gomosub_tags
      })
      .eq("id", form.id);

    setSaving(false);
    if (error) {
      toast.error(error.message || "Не удалось сохранить настройки");
      return;
    }
    toast.success("Настройки g-саба сохранены");
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6">
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Настройки g/{slug}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Название</label>
            <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} maxLength={80} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Описание</label>
            <Textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} maxLength={240} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Правила</label>
            <Textarea value={form.rules_markdown} onChange={(e) => setForm((prev) => ({ ...prev, rules_markdown: e.target.value }))} rows={6} />
            {form.rules_markdown && (
              <div className="border border-border rounded-md p-3 bg-muted/40">
                {renderPreviewContent(form.rules_markdown, "g-settings-rules")}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Обложка</label>
            <ImageUpload
              currentImages={coverImages}
              maxImages={1}
              onImagesUploaded={(urls) => setForm((prev) => ({ ...prev, cover_image_url: urls[0] || "" }))}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Кастомные теги для тредов</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Например: новости, гайды, драма"
                maxLength={24}
              />
              <Button type="button" variant="outline" onClick={addTag} className="w-full sm:w-auto">Добавить</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.gomosub_tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => removeTag(tag)}
                  title="Нажми чтобы удалить"
                >
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => navigate(`/g/${slug}`)} className="w-full sm:w-auto">
              К g-сабу
            </Button>
            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" />
              Сохранить
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GomoSubSettings;
