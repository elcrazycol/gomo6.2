import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Save, Plus, Download } from "lucide-react";
import { toast } from "sonner";
import { renderPreviewContent } from "@/utils/emojiUtils";
import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
import { useOwnerStories } from "@/components/stories/useOwnerStories";
import { useStoriesStore } from "@/stores/storiesStore";
import { isStoryLive } from "@/types/stories";

export type GeneralForm = {
  id: string;
  name: string;
  description: string;
  gomosub_avatar_url: string;
  cover_image_url: string;
  gomosub_tags: string[];
};

type Props = {
  form: GeneralForm;
  setForm: React.Dispatch<React.SetStateAction<GeneralForm>>;
  standardRules: string;
  setStandardRules: (v: string) => void;
  allowedRules: string[];
  forbiddenRules: string[];
  updateRuleItem: (kind: "allowed" | "forbidden", i: number, v: string) => void;
  addRuleItem: (k: "allowed" | "forbidden") => void;
  removeRuleItem: (k: "allowed" | "forbidden", i: number) => void;
  rulesPreview: string;
  tagInput: string;
  setTagInput: (v: string) => void;
  addTag: () => void;
  removeTag: (t: string) => void;
  isOwner: boolean;
  boardVisibility: string;
  slug: string;
  saving: boolean;
  onSave: () => void;
  /** Owner or a can_post_stories role: posting lives here now that the board
      page shows stories only as the avatar ring. */
  canPostStories: boolean;
};

/**
 * Community stories live here now that the board page dropped its stories
 * bar: live count plus the composer entry for owners / can_post_stories
 * roles. Hidden for everyone else when there is nothing live.
 */
function StoriesCard({ boardId, boardName, canPost }: { boardId: string; boardName: string; canPost: boolean }) {
  const { stories } = useOwnerStories("gosub", boardId || null);
  const openComposer = useStoriesStore((s) => s.openComposer);
  const live = stories.filter((s) => isStoryLive(s));
  if (!canPost && live.length === 0) return null;
  return (
    <Card className="rounded-2xl border-border/70">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Истории сообщества</p>
          <p className="truncate text-xs text-muted-foreground">
            {live.length > 0 ? `Сейчас live: ${live.length}` : "Пока нет историй"}
          </p>
        </div>
        {canPost && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openComposer({ ownerType: "gosub", ownerId: boardId, ownerName: boardName })}
            className="shrink-0"
          >
            <Plus className="mr-1 h-4 w-4" />
            Добавить историю
          </Button>
        )}
      </div>
    </Card>
  );
}

const GeneralPanel = (p: Props) => {
  const { form, setForm } = p;
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [exporting, setExporting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const uploadImage = async (file: File, kind: "avatar" | "cover") => {
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(file.type)) { toast.error("Неподдерживаемый формат"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Файл слишком большой. Максимум 10MB"); return; }
    if (kind === "avatar") setUploadingAvatar(true); else setUploadingCover(true);
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) { toast.error("Нужно войти"); return; }
      const ext = file.name.split(".").pop() || "jpg";
      const uploaded = await uploadFile("post-images", `${user.id}/${Date.now()}_${kind}.${ext}`, file);
      if (kind === "avatar") setForm((f) => ({ ...f, gomosub_avatar_url: uploaded.path }));
      else setForm((f) => ({ ...f, cover_image_url: uploaded.path }));
      toast.success(kind === "avatar" ? "Аватар обновлен" : "Фон обновлен");
    } catch (e) {
      toast.error((e instanceof Error ? e.message : String(e)) || "Не удалось загрузить");
    } finally {
      if (kind === "avatar") setUploadingAvatar(false); else setUploadingCover(false);
    }
  };

  const handleExport = async () => {
    if (!form.id) return;
    setExporting(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const res = await fetch(`/api/v1/boards/${form.id}/backup/export`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gomosub-${p.slug}-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Архив скачан");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка экспорта");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <StoriesCard boardId={form.id} boardName={form.name || form.id} canPost={p.canPostStories} />
      <Card className="overflow-hidden rounded-2xl border-border/70">
        <div className="h-24 sm:h-32 bg-muted/30 border-b border-border relative">
          <input ref={coverInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file, "cover"); e.target.value = ""; }} />
          <button type="button" onClick={() => coverInputRef.current?.click()} className="group relative w-full h-full text-left">
            {form.cover_image_url
              ? <img src={storageUrl("post-images", form.cover_image_url) || form.cover_image_url} alt="cover" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">{uploadingCover ? "Загрузка..." : "Нажми, чтобы загрузить обложку"}</div>}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
          </button>
          <div className="absolute -bottom-8 left-4 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-[3px] border-background bg-surface shadow-md overflow-hidden flex items-center justify-center text-xl font-bold text-muted-foreground">
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file, "avatar"); e.target.value = ""; }} />
            <button type="button" onClick={() => avatarInputRef.current?.click()} className="group relative w-full h-full">
              {form.gomosub_avatar_url
                ? <img src={storageUrl("post-images", form.gomosub_avatar_url) || form.gomosub_avatar_url} alt="avatar" className="w-full h-full object-cover" />
                : <span>{uploadingAvatar ? "..." : (form.name.trim()[0] || "g").toUpperCase()}</span>}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
            </button>
          </div>
        </div>
        <div className="px-4 pt-10 pb-3">
          <div className="text-[13px] text-muted-foreground">Для смены фото нажми прямо на аватар или обложку.</div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Название</Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Описание</Label>
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={240} />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Теги</Label>
        <div className="flex flex-wrap gap-1.5">
          {form.gomosub_tags.map((t) => (
            <button key={t} type="button" onClick={() => p.removeTag(t)}
              className="text-xs bg-muted rounded-full px-2.5 py-1 hover:bg-destructive/15" title="Убрать тег">
              {t} ✕
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={p.tagInput} onChange={(e) => p.setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") p.addTag(); }}
            placeholder="Новый тег" maxLength={24} className="h-9" />
          <Button size="sm" variant="outline" onClick={p.addTag}><Plus className="w-4 h-4" /></Button>
        </div>
      </div>

      {p.boardVisibility === "public" && (
        <>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Базовые правила</Label>
            <Textarea value={p.standardRules} onChange={(e) => p.setStandardRules(e.target.value)} rows={3} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Можно</Label>
                <Button size="sm" variant="outline" onClick={() => p.addRuleItem("allowed")}><Plus className="w-4 h-4" /></Button>
              </div>
              {p.allowedRules.map((r, i) => (
                <div key={`a${i}`} className="flex gap-2">
                  <Input value={r} onChange={(e) => p.updateRuleItem("allowed", i, e.target.value)} placeholder="Разрешено" />
                  <Button size="sm" variant="outline" onClick={() => p.removeRuleItem("allowed", i)}>x</Button>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Нельзя</Label>
                <Button size="sm" variant="outline" onClick={() => p.addRuleItem("forbidden")}><Plus className="w-4 h-4" /></Button>
              </div>
              {p.forbiddenRules.map((r, i) => (
                <div key={`f${i}`} className="flex gap-2">
                  <Input value={r} onChange={(e) => p.updateRuleItem("forbidden", i, e.target.value)} placeholder="Запрещено" />
                  <Button size="sm" variant="outline" onClick={() => p.removeRuleItem("forbidden", i)}>x</Button>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground mb-2">Превью правил</div>
            {renderPreviewContent(p.rulesPreview, "g-settings-rules")}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {p.isOwner && (
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}Экспорт
          </Button>
        )}
        <Button onClick={p.onSave} disabled={p.saving}>
          {p.saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Save className="w-4 h-4 mr-2" />Сохранить
        </Button>
      </div>
    </div>
  );
};

export default GeneralPanel;
