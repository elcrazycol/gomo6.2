import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { storageUrl } from "@/utils/storage";
import { Loader2, CheckCircle2, XCircle, Plus } from "lucide-react";

const RESERVED_SLUGS = [
  "b", "pol", "a", "v", "mu", "fit", "d", "tv", "co", "int",
  "rules", "faq", "bugs", "g", "tech", "meta", "admin", "mod", "news"
];

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,24}$/;

type Step = "requirements" | "form";

const GomoSubCreate = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("requirements");
  const [creating, setCreating] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [guideRead, setGuideRead] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [coverImages, setCoverImages] = useState<string[]>([]);
  const [avatarImages, setAvatarImages] = useState<string[]>([]);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    standardRules: "Уважай участников, соблюдай тему саба и не публикуй запрещенный контент.",
  });

  const [allowedRules, setAllowedRules] = useState<string[]>([""]);
  const [forbiddenRules, setForbiddenRules] = useState<string[]>([""]);
  const [garma, setGarma] = useState<number>(0);
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null);

  const garmaOk = useMemo(() => garma >= 10, [garma]);
  const ageOk = useMemo(() => {
    if (!profileCreatedAt) return false;
    return Date.now() - new Date(profileCreatedAt).getTime() >= 14 * 24 * 60 * 60 * 1000;
  }, [profileCreatedAt]);
  const canProceed = garmaOk && ageOk && guideRead;

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("garma, created_at")
        .eq("id", session.user.id)
        .single();
      setGarma(data?.garma ?? 0);
      setProfileCreatedAt(data?.created_at ?? null);
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

  const buildRulesMarkdown = () => {
    const allowed = allowedRules.map((x) => x.trim()).filter(Boolean);
    const forbidden = forbiddenRules.map((x) => x.trim()).filter(Boolean);

    const blocks: string[] = [];
    if (form.standardRules.trim()) {
      blocks.push(form.standardRules.trim());
    }
    if (allowed.length) {
      blocks.push(`Можно\n${allowed.map((x) => `- ${x}`).join("\n")}`);
    }
    if (forbidden.length) {
      blocks.push(`Нельзя\n${forbidden.map((x) => `- ${x}`).join("\n")}`);
    }
    return blocks.join("\n\n").trim() || null;
  };

  const updateRuleItem = (kind: "allowed" | "forbidden", index: number, value: string) => {
    const setter = kind === "allowed" ? setAllowedRules : setForbiddenRules;
    setter((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addRuleItem = (kind: "allowed" | "forbidden") => {
    const setter = kind === "allowed" ? setAllowedRules : setForbiddenRules;
    setter((prev) => [...prev, ""]);
  };

  const removeRuleItem = (kind: "allowed" | "forbidden", index: number) => {
    const setter = kind === "allowed" ? setAllowedRules : setForbiddenRules;
    setter((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [""];
    });
  };

  const uploadSingleImage = async (file: File, kind: "avatar" | "cover") => {
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      toast.error("Неподдерживаемый формат. Используйте JPG, PNG, WEBP или GIF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Файл слишком большой. Максимум 10MB");
      return;
    }

    if (kind === "avatar") setUploadingAvatar(true);
    else setUploadingCover(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Нужно войти в аккаунт");
        return;
      }

      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${user.id}/${Date.now()}_${kind}.${ext}`;
      const { error } = await supabase.storage.from("post-images").upload(fileName, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;

      if (kind === "avatar") setAvatarImages([fileName]);
      else setCoverImages([fileName]);
      toast.success(kind === "avatar" ? "Аватар загружен" : "Фон загружен");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить изображение");
    } finally {
      if (kind === "avatar") setUploadingAvatar(false);
      else setUploadingCover(false);
    }
  };

  const handleCreate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Войдите, чтобы создать g-саб");
      navigate("/auth");
      return;
    }
    if (!(garmaOk && ageOk)) {
      toast.error("Для создания нужно >=10 gармы и аккаунт старше 2 недель");
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
          gomosub_avatar_url: avatarImages[0] ?? null,
          rules_markdown: buildRulesMarkdown(),
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
    <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-4">
      {step === "requirements" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>Создание g-саба</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={`rounded-lg border p-3 ${garmaOk ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/30"}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {garmaOk ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                    10+ gармы
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Текущая gарма: {garma}</div>
                </div>
                <div className={`rounded-lg border p-3 ${ageOk ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-muted/30"}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {ageOk ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                    Аккаунт старше 2 недель
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {profileCreatedAt ? `Создан: ${new Date(profileCreatedAt).toLocaleDateString()}` : "Нет данных"}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div className="text-sm text-muted-foreground">
                  {garmaOk && ageOk ? "Условия выполнены. Можешь перейти к созданию после чтения правил." : "Условия пока не выполнены."}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button variant="outline" onClick={() => setShowGuide(true)}>
                    Прочитать правила
                  </Button>
                  <Button onClick={() => setStep("form")} disabled={!canProceed}>
                    Перейти к созданию
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {step === "form" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden border-primary/30">
            <div className="h-36 sm:h-44 bg-muted/30 border-b border-border relative">
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadSingleImage(file, "cover");
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="group relative w-full h-full text-left"
              >
                {coverImages[0] ? (
                  <img src={storageUrl("post-images", coverImages[0])} alt="cover" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                    {uploadingCover ? "Загрузка..." : "Нажми сюда, чтобы добавить фон"}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
              </button>
              <div className="absolute -bottom-10 left-4 w-20 h-20 rounded-full border-4 border-background bg-card overflow-hidden">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadSingleImage(file, "avatar");
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="group relative w-full h-full"
                >
                {avatarImages[0] ? (
                  <img src={storageUrl("post-images", avatarImages[0])} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl font-bold text-muted-foreground">
                    {uploadingAvatar ? "..." : (form.name.trim()[0] || "g").toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
                </button>
              </div>
            </div>
            <CardContent className="pt-12 space-y-4">
              <div className="text-xs text-muted-foreground">Для смены фото нажми прямо на круглый аватар или фоновый прямоугольник.</div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Название</label>
                  <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} maxLength={80} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Слаг</label>
                  <Input
                    value={form.slug}
                    onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                    placeholder="my-fandom"
                    maxLength={25}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Описание</label>
                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} maxLength={240} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Базовые правила</label>
                <Textarea value={form.standardRules} onChange={(e) => setForm((p) => ({ ...p, standardRules: e.target.value }))} rows={3} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Можно</label>
                    <Button size="sm" variant="outline" onClick={() => addRuleItem("allowed")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {allowedRules.map((rule, index) => (
                    <div key={`allowed-${index}`} className="flex gap-2">
                      <Input value={rule} onChange={(e) => updateRuleItem("allowed", index, e.target.value)} placeholder="Добавить разрешение" />
                      <Button size="sm" variant="outline" onClick={() => removeRuleItem("allowed", index)}>x</Button>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Нельзя</label>
                    <Button size="sm" variant="outline" onClick={() => addRuleItem("forbidden")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {forbiddenRules.map((rule, index) => (
                    <div key={`forbidden-${index}`} className="flex gap-2">
                      <Input value={rule} onChange={(e) => updateRuleItem("forbidden", index, e.target.value)} placeholder="Добавить ограничение" />
                      <Button size="sm" variant="outline" onClick={() => removeRuleItem("forbidden", index)}>x</Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setStep("requirements")}>Назад</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Создать g-саб
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Что такое g-саб</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>g-саб напоминает доску и тред одновременно, но создается для крупного фандома или обсуждения конкретной темы.</p>
            <p>Если тебе нужна отдельная тематическая зона с собственными правилами и тегами - g-саб это нужный формат.</p>
            <Badge variant={guideRead ? "default" : "outline"} className="cursor-pointer" onClick={() => setGuideRead((prev) => !prev)}>
              {guideRead ? "Прочитано" : "Отметить как прочитано"}
            </Badge>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GomoSubCreate;
