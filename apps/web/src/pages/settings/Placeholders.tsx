import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { PentagramLoader } from "@/components/PentagramLoader";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { safeDate } from "@/utils/safeDate";
import { processProfileBio } from "@/utils/profileBio";
import { UserBadge } from "@/components/UserBadge";
import { AdminBadge } from "@/components/AdminBadge";
import { getProfileCustomization, parseCssToStyle } from "@/utils/profileCustomization";

// Ключ 'post_count' сохранён для обратной совместимости с сохранёнными
// user_placeholders, но теперь рендерит объединённое «записи» (записи сабов + стена).
const PRESET_PLACEHOLDERS = [
  { value: '', labelKey: 'placeholderNone' },
  { value: 'bio', labelKey: 'placeholderBio' },
  { value: 'created_at', labelKey: 'placeholderCreatedAt' },
  { value: 'post_count', labelKey: 'placeholderPostCount' },
  { value: 'comment_count', labelKey: 'placeholderCommentCount' },
  { value: 'thread_count', labelKey: 'placeholderThreadCount' },
  { value: 'account_number', labelKey: 'placeholderAccountNumber' },
  { value: 'id', labelKey: 'placeholderUserId' },
];

const Placeholders = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<{
    username?: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    bio?: string | null;
    created_at: string;
    post_count?: number;
    thread_count?: number;
    wall_post_count?: number;
    comment_count?: number;
    account_number?: number;
    id: string;
    avatar_url?: string | null;
  } | null>(null);
  const [customization, setCustomization] = useState<unknown>(null);
  
  const [placeholder1, setPlaceholder1] = useState<string>('bio');
  const [placeholder2, setPlaceholder2] = useState<string>('created_at');
  const [placeholder3, setPlaceholder3] = useState<string>('post_count');
  const [useCustom, setUseCustom] = useState(false);
  const [customPlaceholder, setCustomPlaceholder] = useState('');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setUser(user);

      // Load placeholders
      const { data: placeholders } = await api
        .from("user_placeholders")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (placeholders) {
        const p = placeholders as { placeholder_1?: string; placeholder_2?: string; placeholder_3?: string; use_custom?: boolean; custom_placeholder?: string };
        setPlaceholder1(p.placeholder_1 || 'bio');
        setPlaceholder2(p.placeholder_2 || 'created_at');
        setPlaceholder3(p.placeholder_3 || 'post_count');
        setUseCustom(p.use_custom || false);
        setCustomPlaceholder(p.custom_placeholder || '');
      }

      // Load profile for preview
      const { data: profileData } = await api
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) {
        setProfile(profileData as { username?: string; display_name?: string | null; nickname_emoji_id?: string | null; bio?: string | null; created_at: string; post_count?: number; thread_count?: number; wall_post_count?: number; comment_count?: number; account_number?: number; id: string; avatar_url?: string | null });
      }

      // Load customization
      const custom = await getProfileCustomization(user.id);
      setCustomization(custom);

      setLoading(false);
    };

    getUser();
  }, [navigate]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await api
        .from("user_placeholders")
        .upsert({
          user_id: user.id,
          placeholder_1: placeholder1,
          placeholder_2: placeholder2,
          placeholder_3: placeholder3,
          use_custom: useCustom,
          custom_placeholder: useCustom ? customPlaceholder : null,
        });

      if (error) throw error;

      toast.success(t("settings.placeholdersSaved"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(`${t("common.error")}: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const renderPlaceholder = (value: string) => {
    if (!profile || !value) return null;

    switch (value) {
      case 'bio':
        return profile.bio ? processProfileBio(profile.bio) : null;
      case 'created_at':
        return format(safeDate(profile.created_at), "dd.MM.yyyy", { locale: dateLocale });
      case 'post_count':
        return t("settings.placeholderPostsCount", { count: (profile.thread_count || 0) + (profile.wall_post_count || 0) });
      case 'comment_count':
        return t("settings.placeholderCommentsCount", { count: profile.comment_count || 0 });
      case 'thread_count':
        return t("settings.placeholderThreadsCount", { count: profile.thread_count || 0 });
      case 'account_number':
        return profile.account_number ? `#${profile.account_number}` : null;
      case 'id':
        return profile.id.slice(0, 8);
      default:
        return null;
    }
  };

  const renderPlaceholders = () => {
    if (useCustom && customPlaceholder) {
      return (
        <span className="text-xs text-muted-foreground/70">
          {processProfileBio(customPlaceholder)}
        </span>
      );
    }

    const parts: React.ReactNode[] = [];
    const values = [placeholder1, placeholder2, placeholder3].filter(v => v); // Filter out empty values

    values.forEach((value, index) => {
      const rendered = renderPlaceholder(value);
      if (rendered) {
        if (parts.length > 0) {
          parts.push(<span key={`sep-${index}`}> | </span>);
        }
        parts.push(<span key={value}>{rendered}</span>);
      }
    });

    return parts.length > 0 ? (
      <span className="text-xs text-muted-foreground/70">{parts}</span>
    ) : null;
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user || !profile) {
    return null;
  }

  return (
    <main className="max-w-4xl mx-auto p-4 space-y-6">
          <div className="bg-card border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">{t("settings.placeholderSettingsTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {t("settings.placeholderSettingsDescription")}
            </p>

            <div className="space-y-6">
              <RadioGroup value={useCustom ? 'custom' : 'preset'} onValueChange={(v) => setUseCustom(v === 'custom')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="preset" id="preset" />
                  <Label htmlFor="preset">{t("settings.presetPlaceholders")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="custom" id="custom" />
                  <Label htmlFor="custom">{t("settings.customPlaceholder")}</Label>
                </div>
              </RadioGroup>

              {!useCustom ? (
                <div className="space-y-4">
                  <div>
                    <Label>{t("settings.placeholderOne")}</Label>
                    <select
                      value={placeholder1}
                      onChange={(e) => setPlaceholder1(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{t(`settings.${p.labelKey}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>{t("settings.placeholderTwo")}</Label>
                    <select
                      value={placeholder2}
                      onChange={(e) => setPlaceholder2(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{t(`settings.${p.labelKey}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>{t("settings.placeholderThree")}</Label>
                    <select
                      value={placeholder3}
                      onChange={(e) => setPlaceholder3(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{t(`settings.${p.labelKey}`)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <Label>{t("settings.customPlaceholder")}</Label>
                  <Textarea
                    value={customPlaceholder}
                    onChange={(e) => setCustomPlaceholder(e.target.value)}
                    placeholder={t("settings.customPlaceholderPlaceholder")}
                    rows={3}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("settings.customPlaceholderHint")}
                  </p>
                </div>
              )}

              <Button onClick={handleSave} disabled={saving}>
                {saving ? t("settings.saving") : t("common.save")}
              </Button>
            </div>
          </div>

          {/* Preview */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t("settings.preview")}</h3>
            <div className="bg-post-header p-4 border border-border">
              <div className="flex items-start gap-3">
                <img
                  src={storageUrl("post-images", profile.avatar_url ?? null) || '/placeholder.svg'}
                  alt="Avatar"
                  className="w-12 h-12 rounded-full object-cover border border-border"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1 flex-wrap mb-1">
                    <UserBadge
                      userId={user.id}
                      username={profile.username ?? ''}
                      displayName={profile.display_name}
                      emojiId={profile.nickname_emoji_id}
                      isAnonymous={false}
                      showOutline={false}
                      disableLink={true}
                    />
                    <AdminBadge userId={user.id} />
                  </div>
                  {renderPlaceholders()}
                </div>
              </div>
            </div>
          </Card>
        </main>
  );
};

export default Placeholders;
