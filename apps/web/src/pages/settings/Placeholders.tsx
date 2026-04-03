import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
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
import { ru } from "date-fns/locale";
import { processProfileBio } from "@/utils/profileBio";
import { UserBadge } from "@/components/UserBadge";
import { AdminBadge } from "@/components/AdminBadge";
import { getProfileCustomization, parseCssToStyle } from "@/utils/profileCustomization";

const PRESET_PLACEHOLDERS = [
  { value: '', label: 'Не выбрано' },
  { value: 'bio', label: 'Описание профиля' },
  { value: 'created_at', label: 'Дата регистрации' },
  { value: 'post_count', label: 'Количество постов' },
  { value: 'thread_count', label: 'Количество тредов' },
  { value: 'account_number', label: 'Номер аккаунта' },
  { value: 'id', label: 'ID пользователя' },
];

const Placeholders = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<{ username?: string } | null>(null);
  const [customization, setCustomization] = useState<Record<string, unknown> | null>(null);
  
  const [placeholder1, setPlaceholder1] = useState<string>('bio');
  const [placeholder2, setPlaceholder2] = useState<string>('created_at');
  const [placeholder3, setPlaceholder3] = useState<string>('post_count');
  const [useCustom, setUseCustom] = useState(false);
  const [customPlaceholder, setCustomPlaceholder] = useState('');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/auth");
        return;
      }
      setUser(user);

      // Load placeholders
      const { data: placeholders } = await supabase
        .from("user_placeholders")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (placeholders) {
        setPlaceholder1(placeholders.placeholder_1 || 'bio');
        setPlaceholder2(placeholders.placeholder_2 || 'created_at');
        setPlaceholder3(placeholders.placeholder_3 || 'post_count');
        setUseCustom(placeholders.use_custom || false);
        setCustomPlaceholder(placeholders.custom_placeholder || '');
      }

      // Load profile for preview
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) {
        setProfile(profileData);
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
      const { error } = await supabase
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

      toast.success("Плейсхолдеры сохранены");
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Неизвестная ошибка';
      toast.error(`Ошибка: ${msg}`);
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
        return format(new Date(profile.created_at), "dd.MM.yyyy", { locale: ru });
      case 'post_count':
        return `${profile.post_count || 0} ${profile.post_count === 1 ? 'пост' : profile.post_count < 5 ? 'поста' : 'постов'}`;
      case 'thread_count':
        return `${profile.thread_count || 0} ${profile.thread_count === 1 ? 'тред' : profile.thread_count < 5 ? 'треда' : 'тредов'}`;
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
            <h2 className="text-lg font-semibold mb-4">Настройка плейсхолдеров</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Выберите плейсхолдеры, которые будут отображаться при наведении на ваше имя пользователя
            </p>

            <div className="space-y-6">
              <RadioGroup value={useCustom ? 'custom' : 'preset'} onValueChange={(v) => setUseCustom(v === 'custom')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="preset" id="preset" />
                  <Label htmlFor="preset">Предустановленные плейсхолдеры</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="custom" id="custom" />
                  <Label htmlFor="custom">Кастомный плейсхолдер</Label>
                </div>
              </RadioGroup>

              {!useCustom ? (
                <div className="space-y-4">
                  <div>
                    <Label>Плейсхолдер 1</Label>
                    <select
                      value={placeholder1}
                      onChange={(e) => setPlaceholder1(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Плейсхолдер 2</Label>
                    <select
                      value={placeholder2}
                      onChange={(e) => setPlaceholder2(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Плейсхолдер 3</Label>
                    <select
                      value={placeholder3}
                      onChange={(e) => setPlaceholder3(e.target.value)}
                      className="w-full mt-1 p-2 border border-border rounded bg-background"
                    >
                      {PRESET_PLACEHOLDERS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <Label>Кастомный плейсхолдер</Label>
                  <Textarea
                    value={customPlaceholder}
                    onChange={(e) => setCustomPlaceholder(e.target.value)}
                    placeholder="Введите текст с тегами BBCode, например: [B]Описание[/B] | Дата регистрации | Количество постов"
                    rows={3}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Поддерживаются теги: [B], [I], [U], [S], [col=#color], [size=N], [blur], [me], [dude]
                  </p>
                </div>
              )}

              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>

          {/* Preview */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Предпросмотр</h3>
            <div className="bg-post-header p-4 border border-border">
              <div className="flex items-start gap-3">
                <img
                  src={profile.avatar_url || '/placeholder.svg'}
                  alt="Avatar"
                  className="w-12 h-12 rounded-full object-cover border border-border"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1 flex-wrap mb-1">
                    <UserBadge
                      userId={user.id}
                      username={profile.username}
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
