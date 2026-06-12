import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Settings, Plus, Trash2, GripVertical, Hash } from "lucide-react";
import { toast } from "sonner";
import { renderPreviewContent } from "@/utils/emojiUtils";

const parseRulesMarkdown = (rules: string | null) => {
  const raw = (rules || "").trim();
  if (!raw) {
    return {
      standardRules: "Уважай участников и соблюдай тематику саба.",
      allowedRules: [""],
      forbiddenRules: [""],
    };
  }

  const canMarker = /###\s*Можно/i;
  const cantMarker = /###\s*Нельзя/i;

  const canMatch = raw.search(canMarker);
  const cantMatch = raw.search(cantMarker);

  let standardRules = raw;
  let canPart = "";
  let cantPart = "";

  if (canMatch >= 0 || cantMatch >= 0) {
    const firstBlock = [canMatch, cantMatch].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
    standardRules = raw.slice(0, firstBlock).trim();

    if (canMatch >= 0 && cantMatch >= 0) {
      if (canMatch < cantMatch) {
        canPart = raw.slice(canMatch, cantMatch);
        cantPart = raw.slice(cantMatch);
      } else {
        cantPart = raw.slice(cantMatch, canMatch);
        canPart = raw.slice(canMatch);
      }
    } else if (canMatch >= 0) {
      canPart = raw.slice(canMatch);
    } else if (cantMatch >= 0) {
      cantPart = raw.slice(cantMatch);
    }
  }

  const extractBullets = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.replace(/^-\s*/, ""));

  const allowedRules = extractBullets(canPart);
  const forbiddenRules = extractBullets(cantPart);

  return {
    standardRules: standardRules || "Уважай участников и соблюдай тематику саба.",
    allowedRules: allowedRules.length ? allowedRules : [""],
    forbiddenRules: forbiddenRules.length ? forbiddenRules : [""],
  };
};

const buildRulesMarkdown = (standardRules: string, allowedRules: string[], forbiddenRules: string[]) => {
  const allowed = allowedRules.map((x) => x.trim()).filter(Boolean);
  const forbidden = forbiddenRules.map((x) => x.trim()).filter(Boolean);

  const blocks: string[] = [];
  if (standardRules.trim()) {
    blocks.push(standardRules.trim());
  }
  if (allowed.length) {
    blocks.push(`### Можно\n${allowed.map((x) => `- ${x}`).join("\n")}`);
  }
  if (forbidden.length) {
    blocks.push(`### Нельзя\n${forbidden.map((x) => `- ${x}`).join("\n")}`);
  }

  return blocks.join("\n\n").trim() || null;
};

const GomoSubSettings = () => {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "channels">("general");

  // Channel management state
  const [channels, setChannels] = useState<{ id: string; slug: string; name: string; category: string; sort_order: number }[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelSlug, setNewChannelSlug] = useState("");
  const [newChannelCategory, setNewChannelCategory] = useState("");
  const [addingChannel, setAddingChannel] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    gomosub_avatar_url: "",
    cover_image_url: "",
    gomosub_tags: [] as string[],
  });

  const [standardRules, setStandardRules] = useState("");
  const [allowedRules, setAllowedRules] = useState<string[]>([""]);
  const [forbiddenRules, setForbiddenRules] = useState<string[]>([""]);

  const rulesPreview = useMemo(
    () => buildRulesMarkdown(standardRules, allowedRules, forbiddenRules) || "",
    [standardRules, allowedRules, forbiddenRules]
  );

  const loadChannels = async (boardId: string) => {
    setChannelsLoading(true);
    const response = await fetch(`/api/v1/channels?board_id=eq.${boardId}&order=sort_order.asc`);
    const result = await response.json();
    setChannels((result.data || []) as { id: string; slug: string; name: string; category: string; sort_order: number }[]);
    setChannelsLoading(false);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: board } = await api
        .from("boards")
        .select("id, name, description, rules_markdown, gomosub_avatar_url, cover_image_url, owner_id, gomosub_tags, is_gomosub")
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
        ? board.gomosub_tags.filter((t: unknown): t is string => typeof t === "string")
        : [];

      const parsedRules = parseRulesMarkdown(board.rules_markdown);
      setStandardRules(parsedRules.standardRules);
      setAllowedRules(parsedRules.allowedRules);
      setForbiddenRules(parsedRules.forbiddenRules);

      setIsOwner(true);
      setForm({
        id: board.id,
        name: board.name || "",
        description: board.description || "",
        gomosub_avatar_url: board.gomosub_avatar_url || "",
        cover_image_url: board.cover_image_url || "",
        gomosub_tags: tags,
      });
      setLoading(false);

      // Load channels
      await loadChannels(board.id);
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
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        toast.error("Нужно войти в аккаунт");
        return;
      }

      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${user.id}/${Date.now()}_${kind}.${ext}`;
      await uploadFile("post-images", fileName, file);

      if (kind === "avatar") {
        setForm((prev) => ({ ...prev, gomosub_avatar_url: fileName }));
      } else {
        setForm((prev) => ({ ...prev, cover_image_url: fileName }));
      }
      toast.success(kind === "avatar" ? "Аватар обновлен" : "Фон обновлен");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(errMsg || "Не удалось загрузить изображение");
    } finally {
      if (kind === "avatar") setUploadingAvatar(false);
      else setUploadingCover(false);
    }
  };

  const handleAddChannel = async () => {
    const name = newChannelName.trim();
    const channelSlugTrimmed = newChannelSlug.trim().toLowerCase().replace(/\s+/g, "-") || name.toLowerCase().replace(/\s+/g, "-");
    if (!name) {
      toast.error("Название канала обязательно");
      return;
    }

    setAddingChannel(true);
    const response = await fetch('/api/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: form.id,
        slug: channelSlugTrimmed,
        name,
        category: newChannelCategory.trim() || null,
        sort_order: channels.length,
      }),
    });
    const result = await response.json();
    setAddingChannel(false);

    if (!response.ok || !result.success) {
      toast.error(result.error || "Не удалось создать канал");
      return;
    }

    setNewChannelName("");
    setNewChannelSlug("");
    setNewChannelCategory("");
    await loadChannels(form.id);
    toast.success("Канал создан");
  };

  const handleDeleteChannel = async (channelId: string) => {
    const response = await fetch(`/api/v1/channels?id=eq.${channelId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok || !result.success) {
      toast.error(result.error || "Не удалось удалить канал");
      return;
    }
    await loadChannels(form.id);
    toast.success("Канал удалён");
  };

  const handleUpdateChannel = async (channelId: string, updates: Record<string, unknown>) => {
    const response = await fetch(`/api/v1/channels?id=eq.${channelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      toast.error(result.error || "Не удалось обновить канал");
      return;
    }
    setEditingChannelId(null);
    await loadChannels(form.id);
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
    const { error } = await api
      .from("boards")
      .update({
        name: form.name.trim(),
        description: form.description.trim(),
        rules_markdown: rulesPreview || null,
        gomosub_avatar_url: form.gomosub_avatar_url || null,
        cover_image_url: form.cover_image_url || null,
        gomosub_tags: form.gomosub_tags,
      })
      .eq("id", form.id);

    setSaving(false);
    if (error) {
      toast.error((error as { message?: string }).message || "Не удалось сохранить настройки");
      return;
    }
    toast.success("Настройки g-саба сохранены");
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-4">
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
            {form.cover_image_url ? (
              <img
                src={storageUrl("post-images", form.cover_image_url) || form.cover_image_url}
                alt="cover"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                {uploadingCover ? "Загрузка..." : "Нажми сюда, чтобы обновить фон"}
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
          </button>

          <div className="absolute -bottom-10 left-4 w-20 h-20 rounded-full border-4 border-background bg-card overflow-hidden flex items-center justify-center text-xl font-bold text-muted-foreground">
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
              {form.gomosub_avatar_url ? (
                <img src={storageUrl("post-images", form.gomosub_avatar_url) || form.gomosub_avatar_url} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{uploadingAvatar ? "..." : (form.name.trim()[0] || "g").toUpperCase()}</span>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
            </button>
          </div>
        </div>

        <CardHeader className="pt-12">
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Настройки g/{slug}
          </CardTitle>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "general" | "channels")} className="mt-3">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="general">Основное</TabsTrigger>
              <TabsTrigger value="channels">Каналы</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="space-y-5">
          {activeTab === "general" && (
          <>
          <div className="text-xs text-muted-foreground">Для смены фото нажми прямо на аватар или фоновый прямоугольник в шапке.</div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Название</label>
              <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} maxLength={80} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Описание</label>
              <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} maxLength={240} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Базовые правила</label>
            <Textarea value={standardRules} onChange={(e) => setStandardRules(e.target.value)} rows={3} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Можно</label>
                <Button size="sm" variant="outline" onClick={() => addRuleItem("allowed")}><Plus className="w-4 h-4" /></Button>
              </div>
              {allowedRules.map((rule, idx) => (
                <div key={`allowed-${idx}`} className="flex gap-2">
                  <Input value={rule} onChange={(e) => updateRuleItem("allowed", idx, e.target.value)} placeholder="Добавить разрешение" />
                  <Button size="sm" variant="outline" onClick={() => removeRuleItem("allowed", idx)}>x</Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Нельзя</label>
                <Button size="sm" variant="outline" onClick={() => addRuleItem("forbidden")}><Plus className="w-4 h-4" /></Button>
              </div>
              {forbiddenRules.map((rule, idx) => (
                <div key={`forbidden-${idx}`} className="flex gap-2">
                  <Input value={rule} onChange={(e) => updateRuleItem("forbidden", idx, e.target.value)} placeholder="Добавить ограничение" />
                  <Button size="sm" variant="outline" onClick={() => removeRuleItem("forbidden", idx)}>x</Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Кастомные теги</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="новости, гайды, драмa..." maxLength={24} />
              <Button type="button" variant="outline" onClick={addTag} className="w-full sm:w-auto">Добавить</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.gomosub_tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)} title="Нажми, чтобы удалить">
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>

          </>
          )}

          {activeTab === "channels" && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Каналы — как текстовые каналы в Discord. Создавай тематические разделы внутри g-саба.
              </div>

              {/* Add new channel form */}
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
                <div className="text-sm font-medium">Новый канал</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    placeholder="Название (напр. обсуждение)"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    maxLength={50}
                  />
                  <Input
                    placeholder="Слаг (напр. discussion)"
                    value={newChannelSlug}
                    onChange={(e) => setNewChannelSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                    maxLength={30}
                  />
                  <Input
                    placeholder="Категория (опционально)"
                    value={newChannelCategory}
                    onChange={(e) => setNewChannelCategory(e.target.value)}
                    maxLength={40}
                  />
                </div>
                <Button onClick={handleAddChannel} disabled={addingChannel || !newChannelName.trim()} size="sm">
                  {addingChannel && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить канал
                </Button>
              </div>

              {/* Channel list */}
              {channelsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : channels.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Каналов пока нет. Создай первый!
                </div>
              ) : (
                <div className="space-y-2">
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                      <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                      {editingChannelId === ch.id ? (
                        <div className="flex-1 flex gap-2 items-center">
                          <Input
                            defaultValue={ch.name}
                            className="h-8 flex-1"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleUpdateChannel(ch.id, { name: (e.target as HTMLInputElement).value });
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingChannelId(null)}
                          >
                            Отмена
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate"># {ch.name}</div>
                            <div className="text-xs text-muted-foreground">
                              /c/{ch.slug}
                              {ch.category && <span className="ml-2">· {ch.category}</span>}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingChannelId(ch.id)}
                            title="Переименовать"
                          >
                            ✎
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteChannel(ch.id)}
                            title="Удалить канал"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "general" && (
            <div className="rounded-lg border border-border p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground mb-2">Превью правил</div>
              {renderPreviewContent(rulesPreview, "g-settings-rules")}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => navigate(`/g/${slug}`)}>К g-сабу</Button>
            <Button onClick={handleSave} disabled={saving}>
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
