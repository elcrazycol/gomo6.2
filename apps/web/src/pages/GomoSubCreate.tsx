import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { storageUrl, uploadFile } from "@/utils/storage";
import { Loader2, CheckCircle2, XCircle, Plus, Upload } from "lucide-react";

const RESERVED_SLUGS = [
  "b", "pol", "a", "v", "mu", "fit", "d", "tv", "co", "int",
  "rules", "faq", "bugs", "g", "tech", "meta", "admin", "mod", "news"
];

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,24}$/;

type Step = "requirements" | "form";
type Visibility = "public" | "private";

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
  const [visibility, setVisibility] = useState<Visibility>("public");

  const [allowedRules, setAllowedRules] = useState<string[]>([""]);
  const [forbiddenRules, setForbiddenRules] = useState<string[]>([""]);
  const [garma, setGarma] = useState<number>(0);
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null);

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importInfo, setImportInfo] = useState<Record<string, unknown> | null>(null);
  const [importing, setImporting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const garmaOk = useMemo(() => garma >= 10, [garma]);
  const ageOk = useMemo(() => {
    if (!profileCreatedAt) return false;
    return Date.now() - new Date(profileCreatedAt).getTime() >= 14 * 24 * 60 * 60 * 1000;
  }, [profileCreatedAt]);
  // TODO: uncomment to restore garma (&gt;=10) and account age (&gt;2 weeks) checks
  // const canProceed = garmaOk && ageOk && guideRead;
  const canProceed = guideRead;

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await api.auth.getSession();
      if (!session?.user) return;
      const { data } = await api
        .from("profiles")
        .select("garma, created_at")
        .eq("id", session.user.id)
        .single();
      setGarma((data?.garma as number) ?? 0);
      setProfileCreatedAt((data?.created_at as string) ?? null);
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

  const handleImportFileSelect = async (file: File) => {
    setImportFile(file);
    setImportInfo(null);
    setImportLoading(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const token = session?.access_token;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/v1/boards/import/info", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setImportInfo(data.data);
      } else {
        toast.error(data.error || "Не удалось прочитать архив");
      }
    } catch (e) {
      toast.error("Ошибка чтения архива");
    } finally {
      setImportLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const token = session?.access_token;
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await fetch("/api/v1/boards/backup/import", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const importResult = await res.json();
      if (importResult.success) {
        toast.success("G-саб импортирован");
        setShowImportDialog(false);
        navigate(`/g/${importResult.data.board_slug}`);
      } else {
        toast.error(importResult.error || "Ошибка импорта");
      }
    } catch (e) {
      toast.error("Ошибка импорта");
    } finally {
      setImporting(false);
    }
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
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        toast.error("Нужно войти в аккаунт");
        return;
      }

      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${user.id}/${Date.now()}_${kind}.${ext}`;
      await uploadFile("post-images", fileName, file);

      if (kind === "avatar") setAvatarImages([fileName]);
      else setCoverImages([fileName]);
      toast.success(kind === "avatar" ? "Аватар загружен" : "Фон загружен");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(errMsg || "Не удалось загрузить изображение");
    } finally {
      if (kind === "avatar") setUploadingAvatar(false);
      else setUploadingCover(false);
    }
  };

  const handleCreate = async () => {
    const { data: { user } } = await api.auth.getUser();
    if (!user) {
      toast.error("Войдите, чтобы создать g-саб");
      navigate("/auth");
      return;
    }
    // TODO: uncomment to restore garma & age checks
    // if (!(garmaOk && ageOk)) {
    //   toast.error("Для создания нужно >=10 gармы и аккаунт старше 2 недель");
    //   return;
    // }

    const slug = validate();
    if (!slug) return;

    setCreating(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const token = session?.access_token;

      const res = await fetch('/api/rpc/create_gomosub', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          slug,
          name: form.name.trim(),
          description: form.description.trim(),
          visibility,
          rules_markdown: visibility === "private" ? null : buildRulesMarkdown(),
          cover_image_url: coverImages[0] ?? null,
          gomosub_avatar_url: avatarImages[0] ?? null,
          gomosub_tags: [],
        }),
      });

      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      toast.success("G-саб создан");
      navigate(`/g/${slug}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      toast.error(errMsg || "Не удалось создать g-саб");
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
                <div className="text-sm text-muted-foreground">
                  Или{" "}
                  <button onClick={() => setShowImportDialog(true)} className="text-primary hover:underline inline-flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    импортировать g-sub из архива
                  </button>
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
                  <img src={storageUrl("post-images", coverImages[0]) ?? undefined} alt="cover" className="w-full h-full object-cover" />
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
                  <img src={storageUrl("post-images", avatarImages[0]) ?? undefined} alt="avatar" className="w-full h-full object-cover" />
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

              {/* Visibility Toggle */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
                <label className="text-sm font-medium">Тип g-саба</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setVisibility("public")}
                    className={`flex-1 rounded-lg border p-3 text-left transition-all ${
                      visibility === "public"
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <div className="font-medium text-sm">Публичный</div>
                    <div className="text-xs text-muted-foreground mt-1">Виден всем на /g, нужны правила, любой может вступить</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility("private")}
                    className={`flex-1 rounded-lg border p-3 text-left transition-all ${
                      visibility === "private"
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <div className="font-medium text-sm">Приватный</div>
                    <div className="text-xs text-muted-foreground mt-1">Только по приглашениям, не виден в общем списке, без правил</div>
                  </button>
                </div>
              </div>

              {/* Rules section — only for public gomosubs */}
              {visibility === "public" && (<>
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
              </>)}

              {visibility === "private" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="text-sm text-muted-foreground">
                    Приватный g-саб не виден в общем списке. Доступ только по пригласительным ссылкам.
                    Ты сможешь создать приглашения в настройках после создания.
                  </p>
                </div>
              )}

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

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Импорт g-sub из архива</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Загрузите tar.gz архив, экспортированный из другого g-саба. Будет создана новая копия с вашим аккаунтом владельцем.
            </p>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".tar.gz,.tgz";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleImportFileSelect(file);
                };
                input.click();
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleImportFileSelect(file);
              }}
            >
              {importLoading ? (
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              ) : importFile ? (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-primary" />
                  <p className="text-sm font-medium">{importFile.name}</p>
                  <p className="text-xs text-muted-foreground">{(importFile.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Нажмите или перетащите .tar.gz файл</p>
                </div>
              )}
            </div>

            {importInfo && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="font-medium text-sm">{String(importInfo.board_name || importInfo.board_slug)}</div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Тредов: <span className="text-foreground">{String(importInfo.thread_count)}</span></div>
                  <div>Постов: <span className="text-foreground">{String(importInfo.post_count)}</span></div>
                  <div>Участников: <span className="text-foreground">{String(importInfo.member_count)}</span></div>
                  <div>Каналов: <span className="text-foreground">{String(importInfo.channel_count)}</span></div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportFile(null); setImportInfo(null); }}>
                Отмена
              </Button>
              <Button onClick={handleImport} disabled={!importFile || !importInfo || importing}>
                {importing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Импортировать
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GomoSubCreate;
