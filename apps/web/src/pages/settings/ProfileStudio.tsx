import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ArrowLeft, ImageIcon, Palette, Type, Award, Wand2, Trash2, Check, Loader2 } from "lucide-react";
import { dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";
import { storageUrl, uploadFile } from "@/utils/storage";
import { normalizeProfileBackgroundVariant, PROFILE_BACKGROUND_VARIANTS, type ProfileBackgroundVariant } from "@/utils/profileBackground";
import { applyProfileThemeTokens, generateThemeVariants, isValidThemeTokens, type ThemeTokenMap, type ThemeVariant } from "@/utils/profileTheme";

import { ProfileStudioPreview, type StudioStats } from "./ProfileStudioPreview";
import { UsernameEditor } from "./UsernameEditor";
import { BadgeEditor } from "./BadgeEditor";

const DEFAULT_STATS: StudioStats = { posts: 0, comments: 0, likes: 0, views: 0, garma: 0 };

const ProfileStudio = () => {
  const navigate = useNavigate();

  // Auth & identity
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [nicknameEmojiId, setNicknameEmojiId] = useState<string | null>(null);
  const [stats, setStats] = useState<StudioStats>(DEFAULT_STATS);

  // Customization (raw values matching DB schema)
  const [usernameCss, setUsernameCss] = useState("");
  const [badgeText, setBadgeText] = useState("");
  const [badgeCss, setBadgeCss] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundVariant, setBackgroundVariant] = useState<ProfileBackgroundVariant>("banner");
  const [themeEnabled, setThemeEnabled] = useState(false);
  const [themeTokens, setThemeTokens] = useState<ThemeTokenMap | null>(null);

  // Theme palette picker state
  const [variants, setVariants] = useState<ThemeVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Uploading / saving state
  const [publishing, setPublishing] = useState(false);
  const [autosaving, setAutosaving] = useState(false);

  // Hybrid save: small edits autosave after a debounce; the theme needs an
  // explicit "Publish" (it changes how the profile looks to every viewer).
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ── Hybrid persistence ─────────────────────────────────────────────────
  const persistSmallEdits = useCallback(async () => {
    if (!userId || !dirtyRef.current) return;
    dirtyRef.current = false;
    setAutosaving(true);
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        username_css: usernameCss || null,
        profile_badge_text: badgeText || null,
        profile_badge_css: badgeCss || null,
      });
      if (error) throw error;
      dispatchProfileCacheInvalidate();
    } catch (err) {
      dirtyRef.current = true;
      console.error("Autosave failed:", err);
      toast.error("Не удалось сохранить изменения");
    } finally {
      setAutosaving(false);
    }
  }, [userId, usernameCss, badgeText, badgeCss]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void persistSmallEdits();
    }, 900);
  }, [persistSmallEdits]);

  // ── Load everything on mount ───────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await api.auth.getUser();
        if (!user) {
          navigate("/auth");
          return;
        }
        const uid = user.id;
        setUserId(uid);

        // Profile row: username, display name, avatar, nickname emoji, stats.
        const profileRes = await fetch(`/api/v1/profiles?id=eq.${uid}`);
        const profileResult = await profileRes.json();
        const profile = profileResult.data?.[0];
        if (profile) {
          setUsername((profile.username as string) || "");
          setDisplayName((profile.display_name as string) || (profile.username as string) || "");
          setAvatarUrl((profile.avatar_url as string) || null);
          setNicknameEmojiId((profile.nickname_emoji_id as string) || null);
          setStats({
            posts: (profile.wall_post_count ?? 0) + (profile.thread_count ?? 0),
            comments: profile.comment_count ?? 0,
            likes: profile.likes_received_count ?? 0,
            views: profile.views_received_count ?? 0,
            garma: profile.garma ?? 0,
          });
          setBackgroundVariant(normalizeProfileBackgroundVariant(profile.background_variant));
        }

        // Customization row.
        const { data, error } = await api
          .from("profile_customization")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();

        if (data && !error) {
          const d = data as Record<string, unknown>;
          if (d.username_css) setUsernameCss(d.username_css as string);
          if (d.profile_badge_text) setBadgeText(d.profile_badge_text as string);
          if (d.profile_badge_css) setBadgeCss(d.profile_badge_css as string);
          if (d.background_url) setBackgroundUrl(d.background_url as string);
          if (d.theme_enabled) setThemeEnabled(d.theme_enabled as boolean);
          if (d.theme_tokens && isValidThemeTokens(d.theme_tokens)) {
            setThemeTokens(d.theme_tokens as ThemeTokenMap);
          }
        }
      } catch (err) {
        console.error("Failed to load studio data:", err);
        toast.error("Ошибка загрузки данных");
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [navigate]);

  // Trigger autosave whenever one of the small fields changes.
  useEffect(() => {
    markDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameCss, badgeText, badgeCss]);

  // ── Live theme preview: the chosen palette recolors the whole studio page
  // instantly so the owner feels exactly what viewers will see. Cleanup
  // restores the viewer's own theme on unmount.
  useEffect(() => {
    if (!themeTokens || !isValidThemeTokens(themeTokens)) return;
    return applyProfileThemeTokens(themeTokens);
  }, [themeTokens]);

  const handlePublishTheme = async (enabled?: boolean) => {
    if (!userId) return;
    const target = enabled ?? themeEnabled;
    setPublishing(true);
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        theme_enabled: target,
        theme_tokens: themeTokens ?? {},
      });
      if (error) throw error;
      dispatchProfileCacheInvalidate();
      toast.success(target ? "Тема профиля опубликована" : "Тема профиля выключена");
    } catch (err) {
      console.error("Publish theme failed:", err);
      toast.error("Не удалось опубликовать тему");
    } finally {
      setPublishing(false);
    }
  };

  const handleBackgroundUpload = async (file: File) => {
    if (!userId) return;
    try {
      const fileName = `${userId}/background_${Date.now()}.png`;
      const uploaded = await uploadFile("post-images", fileName, file);

      // Generate the 5 palette candidates from the new image so the owner can
      // pick the best one in the studio; the dominant variant is applied by
      // default (matches the old behavior on the profile page).
      let newTokens: ThemeTokenMap | null = null;
      let newVariants: ThemeVariant[] = [];
      try {
        newVariants = await generateThemeVariants(file);
        const dominant = newVariants.find((v) => v.id === "dominant");
        newTokens = dominant?.tokens ?? newVariants[0]?.tokens ?? null;
      } catch {
        // ignore — theme stays as-is when the image cannot be decoded
      }

      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: uploaded.path,
        ...(newTokens ? { theme_tokens: newTokens } : {}),
      });
      if (error) throw error;

      setBackgroundUrl(uploaded.path);
      if (newVariants.length > 0) {
        setVariants(newVariants);
        setSelectedVariantId(newVariants.find((v) => v.id === "dominant")?.id ?? newVariants[0].id ?? null);
      }
      if (newTokens) setThemeTokens(newTokens);
      dispatchProfileCacheInvalidate();
      toast.success("Фон профиля обновлён");
    } catch (error) {
      toast.error("Ошибка загрузки фона");
      console.error(error);
    }
  };

  const handleBackgroundRemove = async () => {
    if (!userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: null,
      });
      if (error) throw error;
      setBackgroundUrl(null);
      dispatchProfileCacheInvalidate();
      toast.success("Фон убран");
    } catch (error) {
      toast.error("Ошибка удаления фона");
      console.error(error);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!userId) return;
    try {
      const fileName = `${userId}/avatar_${Date.now()}.png`;
      const uploaded = await uploadFile("post-images", fileName, file);
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: uploaded.path }),
      });
      if (!res.ok) throw new Error("Failed to update avatar");
      setAvatarUrl(uploaded.path);
      dispatchProfileCacheInvalidate();
      toast.success("Аватар обновлён");
    } catch (error) {
      toast.error("Ошибка загрузки аватара");
      console.error(error);
    }
  };

  // ── Nickname emoji (same as the profile page edit mode) ───────────────
  const handleNicknameEmojiSelect = async (sel: { emojiId: string }) => {
    if (!userId) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ nickname_emoji_id: sel.emojiId }),
      });
      if (!res.ok) throw new Error("Failed to save nickname emoji");
      setNicknameEmojiId(sel.emojiId);
      dispatchProfileCacheInvalidate();
      toast.success("Эмодзи никнейма сохранён");
    } catch (error) {
      toast.error("Не удалось сохранить эмодзи");
      console.error(error);
    }
  };

  const handleNicknameEmojiRemove = async () => {
    if (!userId) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ nickname_emoji_id: "" }),
      });
      if (!res.ok) throw new Error("Failed to remove nickname emoji");
      setNicknameEmojiId(null);
      dispatchProfileCacheInvalidate();
      toast.success("Эмодзи никнейма убран");
    } catch (error) {
      toast.error("Не удалось убрать эмодзи");
      console.error(error);
    }
  };

  const handleVariantSelect = (id: ThemeVariant["id"]) => {
    const variant = variants.find((v) => v.id === id);
    if (!variant) return;
    setSelectedVariantId(id);
    setThemeTokens(variant.tokens);
  };

  const handleRegenerateVariants = async () => {
    if (!userId || !backgroundUrl) {
      toast.error("Сначала загрузите фон");
      return;
    }
    setPublishing(true);
    try {
      // Refetch the current background image as a blob and regenerate the
      // palette candidates from it.
      const url = storageUrl("post-images", backgroundUrl) || backgroundUrl;
      const res = await fetch(url);
      const blob = await res.blob();
      const newVariants = await generateThemeVariants(blob);
      if (newVariants.length === 0) throw new Error("no variants");
      setVariants(newVariants);
      const dominant = newVariants.find((v) => v.id === "dominant");
      setSelectedVariantId(dominant?.id ?? newVariants[0].id ?? null);
      const tokens = dominant?.tokens ?? newVariants[0].tokens ?? null;
      if (tokens) {
        setThemeTokens(tokens);
        const { error } = await api.from("profile_customization").upsert({
          user_id: userId,
          theme_tokens: tokens,
        });
        if (error) throw error;
        dispatchProfileCacheInvalidate();
      }
      toast.success("Палитры пересозданы — выберите лучшую");
    } catch {
      toast.error("Не удалось пересоздать палитры");
    } finally {
      setPublishing(false);
    }
  };

  const handleOwnerVariantChange = async (variant: ProfileBackgroundVariant) => {
    setBackgroundVariant(variant);
    if (!userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_variant: variant,
      });
      if (error) throw error;
      dispatchProfileCacheInvalidate();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!userId) return null;

  return (
    <main className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings/profile")} className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Студия профиля</h1>
            <p className="text-sm text-muted-foreground hidden sm:block">
              Один экран для всего дизайна: шапка, фон, тема, никнейм и бейдж
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {autosaving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Сохраняем…
            </span>
          )}
          <Button onClick={() => handlePublishTheme()} disabled={publishing} className="gap-2">
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Опубликовать
          </Button>
        </div>
      </div>

      {/* Mobile sticky compact preview */}
      <div className="lg:hidden sticky top-2 z-20 mb-4">
        <ProfileStudioPreview
          username={username}
          displayName={displayName}
          avatarUrl={avatarUrl}
          backgroundUrl={backgroundUrl}
          hasBackground={!!backgroundUrl}
          usernameCss={usernameCss}
          badgeText={badgeText}
          badgeCss={badgeCss}
          nicknameEmojiId={nicknameEmojiId}
          stats={stats}
          compact
          onAvatarUpload={handleAvatarUpload}
          onBackgroundUpload={handleBackgroundUpload}
          onEmojiSelect={handleNicknameEmojiSelect}
          onEmojiRemove={handleNicknameEmojiRemove}
        />
      </div>

      {/* Main layout: tabs + sticky preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Left: editors */}
        <div>
          <Tabs defaultValue="header" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="header" className="gap-1.5 text-xs sm:text-sm">
                <ImageIcon className="w-3.5 h-3.5" />
                Шапка
              </TabsTrigger>
              <TabsTrigger value="theme" className="gap-1.5 text-xs sm:text-sm">
                <Palette className="w-3.5 h-3.5" />
                Тема
              </TabsTrigger>
              <TabsTrigger value="username" className="gap-1.5 text-xs sm:text-sm">
                <Type className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Никнейм</span>
                <span className="sm:hidden">Ник</span>
              </TabsTrigger>
              <TabsTrigger value="badge" className="gap-1.5 text-xs sm:text-sm">
                <Award className="w-3.5 h-3.5" />
                Бейдж
              </TabsTrigger>
            </TabsList>

            {/* ── Шапка и фон ─────────────────────────────────────────── */}
            <TabsContent value="header">
              <Card className="p-4 sm:p-6 space-y-6">
                <div>
                  <p className="text-sm font-medium mb-2">Как показывать ваш фон зрителям</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {PROFILE_BACKGROUND_VARIANTS.map((variant) => {
                      const isSelected = backgroundVariant === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => handleOwnerVariantChange(variant.id)}
                          className={`rounded-lg border p-2 text-left transition-all ${
                            isSelected ? "border-primary/70 bg-primary/8" : "border-border hover:border-primary/30"
                          }`}
                        >
                          <div className="h-10 rounded-md border border-white/10 mb-1.5" style={{ background: variant.preview }} />
                          <div className="text-xs font-medium leading-tight">{variant.name}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Этот вариант видят все, кто заходит на ваш профиль. Аватар и фон меняются по клику прямо в превью.
                  </p>
                </div>

                {backgroundUrl && (
                  <div>
                    <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={handleBackgroundRemove}>
                      <Trash2 className="w-4 h-4" /> Убрать фон
                    </Button>
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* ── Тема ─────────────────────────────────────────────────── */}
            <TabsContent value="theme">
              <Card className="p-4 sm:p-6 space-y-6">
                {/* Toggle for viewers */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2">
                  <div>
                    <Label htmlFor="studio-theme-enabled" className="text-sm font-semibold block">
                      Показывать тему зрителям
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Хедер, кнопки и карточки вашего профиля перекрасятся в выбранную палитру
                    </p>
                  </div>
                  <Switch
                    id="studio-theme-enabled"
                    checked={themeEnabled}
                    onCheckedChange={(v) => {
                      setThemeEnabled(v);
                      void handlePublishTheme(v);
                    }}
                  />
                </div>

                {/* Regenerate */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Палитры из фона</p>
                    <p className="text-xs text-muted-foreground">
                      {variants.length > 0
                        ? "Выберите вариант — он станет темой профиля"
                        : backgroundUrl
                          ? "Варианты не сгенерированы — создайте их заново"
                          : "Загрузите фон, чтобы сгенерировать варианты"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={handleRegenerateVariants} disabled={!backgroundUrl || publishing}>
                    <Wand2 className="w-4 h-4" /> Сгенерировать
                  </Button>
                </div>

                {/* Variant picker */}
                {variants.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {variants.map((v) => {
                      const isSelected = selectedVariantId === v.id;
                      const c = v.color;
                      const swatch = `hsl(${c.h} ${c.s}% ${c.l}%)`;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => handleVariantSelect(v.id)}
                          className={`rounded-lg border p-2 text-left transition-all ${
                            isSelected ? "border-primary/70 bg-primary/8" : "border-border hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="w-6 h-6 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: swatch }} />
                            <span className="text-xs font-medium truncate">{v.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                          </div>
                          <div className="h-8 rounded-md border border-white/10" style={{ background: `linear-gradient(135deg, ${swatch}, hsl(${c.h} ${c.s * 0.5}% ${Math.min(98, c.l + 25)}%))` }} />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Manual token pickers (first pass: primary + background) */}
                {themeTokens && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-sm font-medium">Ручная правка</p>
                    <TokenColorPicker
                      label="Основной цвет"
                      tokenKey="--primary"
                      tokens={themeTokens}
                      onChange={(next) => setThemeTokens(next)}
                    />
                    <TokenColorPicker
                      label="Фон страницы"
                      tokenKey="--background"
                      tokens={themeTokens}
                      onChange={(next) => setThemeTokens(next)}
                    />
                  </div>
                )}

                <Button onClick={() => handlePublishTheme()} disabled={publishing} className="w-full gap-2">
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Опубликовать тему
                </Button>
              </Card>
            </TabsContent>

            {/* ── Никнейм ──────────────────────────────────────────────── */}
            <TabsContent value="username">
              <Card className="p-4 sm:p-6">
                <UsernameEditor value={usernameCss} onChange={setUsernameCss} />
              </Card>
            </TabsContent>

            {/* ── Бейдж ────────────────────────────────────────────────── */}
            <TabsContent value="badge">
              <Card className="p-4 sm:p-6">
                <BadgeEditor
                  text={badgeText}
                  css={badgeCss}
                  onTextChange={setBadgeText}
                  onCssChange={setBadgeCss}
                />
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: sticky preview (desktop) — click avatar/background to replace */}
        <div className="hidden lg:block lg:sticky lg:top-4">
          <ProfileStudioPreview
            username={username}
            displayName={displayName}
            avatarUrl={avatarUrl}
            backgroundUrl={backgroundUrl}
            hasBackground={!!backgroundUrl}
            usernameCss={usernameCss}
            badgeText={badgeText}
            badgeCss={badgeCss}
            nicknameEmojiId={nicknameEmojiId}
            stats={stats}
            onAvatarUpload={handleAvatarUpload}
            onBackgroundUpload={handleBackgroundUpload}
            onEmojiSelect={handleNicknameEmojiSelect}
            onEmojiRemove={handleNicknameEmojiRemove}
          />
        </div>
      </div>
    </main>
  );
};

/**
 * A single HSL-token color picker: shows a color input + hex text field and
 * writes the resulting HSL triplet back into the token map.
 */
function TokenColorPicker({
  label,
  tokenKey,
  tokens,
  onChange,
}: {
  label: string;
  tokenKey: keyof ThemeTokenMap;
  tokens: ThemeTokenMap;
  onChange: (next: ThemeTokenMap) => void;
}) {
  const raw = tokens[tokenKey] || "";
  const hex = useMemo(() => hslToHex(raw), [raw]);

  const update = (hexValue: string) => {
    const hsl = hexToHsl(hexValue);
    if (!hsl) return;
    onChange({ ...tokens, [tokenKey]: `${hsl.h} ${hsl.s}% ${hsl.l}%` });
  };

  const id = `studio-color-${tokenKey}`;
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground w-28 shrink-0">{label}</Label>
      <Input
        id={id}
        type="color"
        value={hex}
        onChange={(e) => update(e.target.value)}
        className="w-12 h-9 p-1 cursor-pointer"
      />
      <Input
        type="text"
        value={raw}
        onChange={(e) => onChange({ ...tokens, [tokenKey]: e.target.value })}
        className="flex-1 font-mono text-xs"
      />
    </div>
  );
}

/** "h s% l%" → #rrggbb (approximate; falls back to #000000 on bad input). */
function hslToHex(hsl: string): string {
  const m = hsl.trim().match(/^(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%$/);
  if (!m) return "#000000";
  const h = parseInt(m[1], 10) % 360;
  const s = Math.min(100, Math.max(0, parseInt(m[2], 10))) / 100;
  const l = Math.min(100, Math.max(0, parseInt(m[3], 10))) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m2 = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m2) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** #rrggbb → "h s% l%" (or null for bad input). */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export default ProfileStudio;
