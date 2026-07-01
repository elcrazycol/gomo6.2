import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Palette, Image, Award, ArrowLeft, Save } from "lucide-react";
import { clearCustomizationCache, dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";
import { storageUrl } from "@/utils/storage";

import { ProfilePreview } from "./ProfilePreview";
import { UsernameEditor } from "./UsernameEditor";
import { IconEditor } from "./IconEditor";
import { BadgeEditor } from "./BadgeEditor";

const CustomProfile = () => {
  const navigate = useNavigate();

  // Auth & profile
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Customization (raw values matching DB schema)
  const [usernameCss, setUsernameCss] = useState("");
  const [iconSvg, setIconSvg] = useState("");
  const [iconFill, setIconFill] = useState("#ffffff");
  const [iconStroke, setIconStroke] = useState("#000000");
  const [badgeText, setBadgeText] = useState("");
  const [badgeCss, setBadgeCss] = useState("");

  // Track if anything changed
  const [hasChanges, setHasChanges] = useState(false);
  const initialSnapshotRef = useRef("");

  // Mark changes whenever customization state updates
  useEffect(() => {
    if (!initialSnapshotRef.current) return;
    const current = JSON.stringify({ usernameCss, iconSvg, iconFill, iconStroke, badgeText, badgeCss });
    setHasChanges(current !== initialSnapshotRef.current);
  }, [usernameCss, iconSvg, iconFill, iconStroke, badgeText, badgeCss]);

  // Load user and customization
  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user: authUser } } = await api.auth.getUser();
        if (!authUser) {
          navigate("/auth");
          return;
        }
        setUser(authUser as { id: string });

        // Load profile
        const { data: profile } = await api
          .from("profiles")
          .select("username, avatar_url")
          .eq("id", authUser.id)
          .single();

        if (profile) {
          const p = profile as Record<string, unknown>;
          setUsername((p.username as string) || "");
          setAvatarUrl(storageUrl("post-images", p.avatar_url as string | null));
        }

        // Load customization
        const { data, error } = await api
          .from("profile_customization")
          .select("*")
          .eq("user_id", authUser.id)
          .maybeSingle();

        const loadedValues = {
          usernameCss: "",
          iconSvg: "",
          iconFill: "#ffffff",
          iconStroke: "#000000",
          badgeText: "",
          badgeCss: "",
        };

        if (data && !error) {
          const d = data as Record<string, unknown>;
          if (d.username_css) { loadedValues.usernameCss = d.username_css as string; setUsernameCss(loadedValues.usernameCss); }
          if (d.username_icon_svg) { loadedValues.iconSvg = d.username_icon_svg as string; setIconSvg(loadedValues.iconSvg); }
          if (d.username_icon_fill) { loadedValues.iconFill = d.username_icon_fill as string; setIconFill(loadedValues.iconFill); }
          if (d.username_icon_stroke) { loadedValues.iconStroke = d.username_icon_stroke as string; setIconStroke(loadedValues.iconStroke); }
          if (d.profile_badge_text) { loadedValues.badgeText = d.profile_badge_text as string; setBadgeText(loadedValues.badgeText); }
          if (d.profile_badge_css) { loadedValues.badgeCss = d.profile_badge_css as string; setBadgeCss(loadedValues.badgeCss); }
        }

        // Set snapshot immediately after loading to avoid race condition
        initialSnapshotRef.current = JSON.stringify(loadedValues);
      } catch (err) {
        console.error("Failed to load customization:", err);
        toast.error("Ошибка загрузки данных");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [navigate]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await api
        .from("profile_customization")
        .upsert({
          user_id: user.id,
          username_css: usernameCss || null,
          username_icon_svg: iconSvg || null,
          username_icon_fill: iconFill || null,
          username_icon_stroke: iconStroke || null,
          profile_badge_text: badgeText || null,
          profile_badge_css: badgeCss || null,
        });

      if (error) throw error;

      clearCustomizationCache(user.id);
      dispatchProfileCacheInvalidate();
      initialSnapshotRef.current = JSON.stringify({ usernameCss, iconSvg, iconFill, iconStroke, badgeText, badgeCss });
      setHasChanges(false);
      toast.success("Кастомизация сохранена!");
    } catch (err) {
      console.error("Error saving customization:", err);
      toast.error("Ошибка сохранения: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Keep latest handleSave in a ref so the keyboard handler is never stale
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges && !saving) handleSaveRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasChanges, saving]);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <main className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/settings/profile")}
            className="shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Кастомизация профиля</h1>
            <p className="text-sm text-muted-foreground">
              Настройте внешний вид никнейма, иконки и бейджа
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>

      {/* Main layout: editors + sticky preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left: Editors */}
        <div>
          <Tabs defaultValue="username" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="username" className="gap-1.5 text-xs sm:text-sm">
                <Palette className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Никнейм</span>
                <span className="sm:hidden">Ник</span>
              </TabsTrigger>
              <TabsTrigger value="icon" className="gap-1.5 text-xs sm:text-sm">
                <Image className="w-3.5 h-3.5" />
                Иконка
              </TabsTrigger>
              <TabsTrigger value="badge" className="gap-1.5 text-xs sm:text-sm">
                <Award className="w-3.5 h-3.5" />
                Бейдж
              </TabsTrigger>
            </TabsList>

            <TabsContent value="username">
              <Card className="p-4 sm:p-6">
                <UsernameEditor value={usernameCss} onChange={setUsernameCss} />
              </Card>
            </TabsContent>

            <TabsContent value="icon">
              <Card className="p-4 sm:p-6">
                <IconEditor
                  svg={iconSvg}
                  fill={iconFill}
                  stroke={iconStroke}
                  onSvgChange={setIconSvg}
                  onFillChange={setIconFill}
                  onStrokeChange={setIconStroke}
                />
              </Card>
            </TabsContent>

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

        {/* Right: Sticky preview */}
        <div className="lg:sticky lg:top-4">
          <ProfilePreview
            username={username}
            avatarUrl={avatarUrl}
            usernameCss={usernameCss}
            iconSvg={iconSvg}
            iconFill={iconFill}
            iconStroke={iconStroke}
            badgeText={badgeText}
            badgeCss={badgeCss}
          />

          {/* Save hint */}
          {hasChanges && (
            <p className="text-xs text-muted-foreground text-center mt-3 animate-pulse">
              У вас есть несохранённые изменения
            </p>
          )}
        </div>
      </div>

      {/* Bottom save (mobile) */}
      <div className="mt-6 flex justify-end lg:hidden">
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          size="lg"
          className="w-full sm:w-auto gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? "Сохранение..." : "Сохранить кастомизацию"}
        </Button>
      </div>
    </main>
  );
};

export default CustomProfile;
