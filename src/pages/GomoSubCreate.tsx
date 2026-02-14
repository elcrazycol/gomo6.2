import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ImageUpload";
import { Loader2, NotebookPen, ShieldCheck } from "lucide-react";
import { renderPreviewContent } from "@/utils/emojiUtils";

const RESERVED_SLUGS = [
  "b", "pol", "a", "v", "mu", "fit", "d", "tv", "co", "int",
  "rules", "faq", "bugs", "g", "tech", "meta", "admin", "mod", "news"
];

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,24}$/;

const GomoSubCreate = () => {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [coverImages, setCoverImages] = useState<string[]>([]);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    rules_markdown: ""
  });
  const [garma, setGarma] = useState<number>(0);

  const canCreate = useMemo(() => garma > 100, [garma]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("garma")
        .eq("id", session.user.id)
        .single();
      setGarma(data?.garma ?? 0);
    };
    load();
  }, []);

  const validate = () => {
    const trimmedSlug = form.slug.trim().toLowerCase();
    if (!SLUG_REGEX.test(trimmedSlug)) {
      toast.error("Слаг: латиница, цифры, - или _, от 2 до 25 символов");
      return null;
    }
    if (RESERVED_SLUGS.includes(trimmedSlug)) {
      toast.error("Слаг зарезервирован системой");
      return null;
    }
    if (!form.name.trim()) {
      toast.error("Название обязательно");
      return null;
    }
    if (!form.description.trim()) {
      toast.error("Описание обязательно");
      return null;
    }
    return trimmedSlug;
  };

  const handleCreate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Войдите, чтобы создать g-саб");
      navigate("/auth");
      return;
    }
    if (!canCreate) {
      toast.error("Нужно больше 100 gармы");
      return;
    }

    const slug = validate();
    if (!slug) return;

    setCreating(true);
    try {
      const { data: existing } = await supabase
        .from("boards")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (existing) {
        toast.error("Такой слаг уже занят");
        return;
      }

      const { error } = await supabase
        .from("boards")
        .insert({
          slug,
          name: form.name.trim(),
          description: form.description.trim(),
          owner_id: user.id,
          is_gomosub: true,
          cover_image_url: coverImages[0] ?? null,
          rules_markdown: form.rules_markdown.trim() || null,
          gomosub_tags: []
        });

      if (error) throw error;

      toast.success("G-саб создан");
      navigate(`/g/${slug}`);
    } catch (error: any) {
      toast.error(error?.message || "Не удалось создать g-саб");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6">
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="text-xl">Создание g-саба</CardTitle>
          <p className="text-sm text-muted-foreground">
            gарма: {garma}. Нужно &gt;100.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Слаг (URL)</label>
              <Input
                placeholder="mystic"
                value={form.slug}
                onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                maxLength={25}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Название</label>
              <Input
                placeholder="Тематика саба"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={80}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Описание</label>
            <Textarea
              placeholder="Кратко о тематике и целях саба"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              rows={3}
              maxLength={240}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              Правила
              <Badge variant="outline" className="text-xs">что можно / нельзя</Badge>
            </label>
            <Textarea
              placeholder="Опишите правила саба"
              value={form.rules_markdown}
              onChange={(e) => setForm((prev) => ({ ...prev, rules_markdown: e.target.value }))}
              rows={6}
            />
            {form.rules_markdown && (
              <div className="border border-border rounded-md p-3 bg-muted/40">
                <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                  <NotebookPen className="w-4 h-4" /> Превью
                </div>
                {renderPreviewContent(form.rules_markdown, "g-create-rules")}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Обложка (опционально)</label>
            <ImageUpload
              currentImages={coverImages}
              maxImages={1}
              onImagesUploaded={(urls) => setCoverImages(urls)}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => navigate("/g")} className="w-full sm:w-auto">
              Назад к списку
            </Button>
            <Button onClick={handleCreate} disabled={creating || !canCreate} className="w-full sm:w-auto">
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <ShieldCheck className="w-4 h-4 mr-2" />
              Создать g-саб
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GomoSubCreate;
