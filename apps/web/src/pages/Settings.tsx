import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, HelpCircle, Type, Palette } from "lucide-react";
import { TwoFASection } from "@/components/TwoFASection";
import { PasskeysSettings } from "@/components/PasskeysSettings";
import { applyTheme, DEFAULT_DARK_MODE, DEFAULT_THEME, type ColorTheme, getStoredTheme, syncSharedAppearanceCookies } from "@/utils/theme";

const defaultPrivacySettings = {
  show_online_status: true,
  show_profile_wall: true,
  allow_wall_posts_from_others: true,
  show_profile_stats: false,
  show_detailed_stats: false,
  remove_image_metadata: true,
  stats_visibility: {
    garma: false,
    posts: false,
    threads: false,
    postLikes: false,
    threadLikes: false,
    replies: false,
    time: false,
  },
  private_profile: false,
  private_hide_avatar: true,
  private_hide_wall: true,
  private_hide_threads: true,
  private_hide_stats: true,
  private_hide_friends: true,
  private_hide_gifts: true,
  private_hide_achievements: true,
};

const themeOptions: Array<{
  id: ColorTheme;
  name: string;
  description: string;
  accent: string;
  preview: string;
}> = [
  { id: "graphite", name: "Монохромный графит", description: "Строго, чисто, читаемо", accent: "#0078D7", preview: "linear-gradient(135deg, #1E1E1E 0%, #2D2D2D 50%, #3C3C3C 100%)" },
  { id: "lavender", name: "Космический лавандовый", description: "Мягкий неон и уютный glow", accent: "#C6A9FF", preview: "linear-gradient(135deg, #1A1625 0%, #2D2440 55%, #B0FFE6 130%)" },
  { id: "volcanic", name: "Вулканический пепел", description: "Антрацит и тлеющий оранжевый", accent: "#FF4D00", preview: "linear-gradient(135deg, #1F1F1F 0%, #2A2422 50%, #FF4D00 140%)" },
  { id: "mint", name: "Мятный лимонад", description: "Светло, плоско, свежо", accent: "#00FFA3", preview: "linear-gradient(135deg, #F0FFF4 0%, #E6FFF1 55%, #F5FF7A 120%)" },
  { id: "glitch", name: "Глитч-кор", description: "RGB-двоение и цифровой шум", accent: "#00FFFF", preview: "linear-gradient(135deg, #121212 0%, #1D1D1D 50%, #2A1030 100%)" },
  { id: "acid", name: "Кислотный шторм", description: "Неон, кислотный glow, киберпанк", accent: "#39FF14", preview: "linear-gradient(135deg, #000000 0%, #081507 45%, #FF10F0 130%)" },
  { id: "void", name: "Пустота", description: "Только черный, белый и воздух", accent: "#FFFFFF", preview: "linear-gradient(135deg, #000000 0%, #101010 45%, #4A4A4A 100%)" },
  { id: "cannabis", name: "Зелёная каннабиоидная", description: "Старый фирменный зелёный", accent: "#3FA34D", preview: "linear-gradient(135deg, #1E2A1E 0%, #315C31 100%)" },
  { id: "pink", name: "Розовая няшная", description: "Мягкая и яркая", accent: "#FF4FA3", preview: "linear-gradient(135deg, #2A1722 0%, #7C2B5B 100%)" },
  { id: "blue", name: "Синяя депрессивная", description: "Холодная и спокойная", accent: "#4D7CFE", preview: "linear-gradient(135deg, #172033 0%, #27496D 100%)" },
  { id: "blood", name: "Кроваво-красная", description: "Контрастная и жёсткая", accent: "#D62839", preview: "linear-gradient(135deg, #2A1113 0%, #701B26 100%)" },
  { id: "pumpkin", name: "Оранжево-тыквенная", description: "Тёплая и насыщенная", accent: "#FF8A00", preview: "linear-gradient(135deg, #2B190C 0%, #8C4A0F 100%)" },
];

const Settings = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [privacySettings, setPrivacySettings] = useState<PrivacySettingsData>(defaultPrivacySettings);

  interface PrivacySettingsData {
    show_online_status: boolean;
    show_profile_wall: boolean;
    allow_wall_posts_from_others: boolean;
    show_profile_stats: boolean;
    show_detailed_stats: boolean;
    remove_image_metadata: boolean;
    stats_visibility: Record<string, boolean>;
    private_profile: boolean;
    private_hide_avatar: boolean;
    private_hide_wall: boolean;
    private_hide_threads: boolean;
    private_hide_stats: boolean;
    private_hide_friends: boolean;
    private_hide_gifts: boolean;
    private_hide_achievements: boolean;
  }
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [fontSettingsExpanded, setFontSettingsExpanded] = useState(false);
  const [customFont, setCustomFont] = useState(() => {
    return localStorage.getItem('custom_font') || '';
  });
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Theme settings
  const [{ colorTheme, isDarkMode }, setThemeState] = useState(() => {
    const stored = getStoredTheme();
    return {
      colorTheme: stored.colorTheme ?? DEFAULT_THEME,
      isDarkMode: stored.isDarkMode ?? DEFAULT_DARK_MODE,
    };
  });

  // Interface settings
  const [senderDisplayType, setSenderDisplayType] = useState<'classic' | 'modern'>(() => {
    return (localStorage.getItem('sender-display-type') as 'classic' | 'modern' | null) || 'classic';
  });
  const settingsTabs = useMemo(() => ["appearance", "profile", "account", "privacy"] as const, []);
  const currentTab = useMemo(() => {
    const pathPart = location.pathname.split("/")[2] || "appearance";
    return settingsTabs.includes(pathPart as (typeof settingsTabs)[number]) ? pathPart : "appearance";
  }, [location.pathname, settingsTabs]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await api.auth.getUser();
      setUser(user);
      
      if (user) {
        const token = (await api.auth.getSession()).data.session?.access_token;
        const headers = { 'Authorization': `Bearer ${token}` };

        // Load current user profile and color
        const profileRes = await fetch(`/api/v1/profiles?id=eq.${user.id}`, { headers });
        const profileResult = await profileRes.json();
        const profile = profileResult.data?.[0];

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${user.id}`, { headers });
        const achResult = await achRes.json();
        const achievements = achResult.data;

        if (achievements) {
          const colorRewards = achievements
            .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown> | undefined)?.reward_type === "username_color")
            .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
      }
      
      setLoading(false);
    };

    getUser();
  }, []);

  const loadPrivacySettings = useCallback(async () => {
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = token ? { 'Authorization': `Bearer ${token}` } : undefined;

      const res = await fetch(`/api/v1/privacy_settings?user_id=eq.${user.id}`, { headers });
      const result = await res.json();
      const data = result.data?.[0];

      if (data) {
        const saved = localStorage.getItem(`privacy_settings_${user.id}`);
        const localOverrides = saved ? JSON.parse(saved) : {};
        const merged = {
          ...defaultPrivacySettings,
          ...data,
          ...localOverrides,
        };
        setPrivacySettings(merged);
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(merged));
        return;
      }

      // If no data in database (new user), create default settings
      if (token) {
        const defaultSettings = {
          ...defaultPrivacySettings,
          user_id: user.id,
        };

        const insertRes = await fetch('/api/v1/privacy_settings', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(defaultSettings),
        });
        const insertResult = await insertRes.json();
        const insertedData = insertResult.data;

        if (insertedData) {
          const mergedInserted = {
            ...defaultPrivacySettings,
            ...insertedData,
          };
          setPrivacySettings(mergedInserted);
          localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(mergedInserted));
          return;
        }
      }
    } catch (error) {
      console.error('Error loading privacy settings from database:', error);
    }

    // Fallback to localStorage if database is unavailable
    const saved = localStorage.getItem(`privacy_settings_${user.id}`);
    if (saved) {
      try {
        const parsedSettings = JSON.parse(saved);
        setPrivacySettings({
          ...defaultPrivacySettings,
          ...parsedSettings,
        });
        return;
      } catch (error) {
        console.error('Error parsing saved privacy settings:', error);
      }
    }

    // Last resort: use hardcoded defaults
    setPrivacySettings(defaultPrivacySettings);
  }, [user?.id]);

  const updatePrivacySetting = async (key: string, value: boolean | Record<string, boolean>) => {
    if (!privacySettings || !user) return;

    setPrivacyLoading(true);
    try {
      const updatedSettings = { ...privacySettings, [key]: value };
      setPrivacySettings(updatedSettings);

      // Prepare data for database
      const dbData = {
        show_online_status: updatedSettings.show_online_status,
        show_profile_wall: updatedSettings.show_profile_wall,
        allow_wall_posts_from_others: updatedSettings.allow_wall_posts_from_others,
        show_profile_stats: updatedSettings.show_profile_stats ?? false,
        show_detailed_stats: updatedSettings.show_detailed_stats ?? false,
        remove_image_metadata: updatedSettings.remove_image_metadata,
        private_profile: updatedSettings.private_profile,
        private_hide_avatar: updatedSettings.private_hide_avatar,
        private_hide_wall: updatedSettings.private_hide_wall,
        private_hide_threads: updatedSettings.private_hide_threads,
        private_hide_stats: updatedSettings.private_hide_stats,
        private_hide_friends: updatedSettings.private_hide_friends,
        private_hide_gifts: updatedSettings.private_hide_gifts,
        private_hide_achievements: updatedSettings.private_hide_achievements,
      };

      // Try to save to database
      try {
        const updateRes = await fetch(`/api/v1/privacy_settings?user_id=eq.${user.id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${(await api.auth.getSession()).data.session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(dbData),
        });

        if (!updateRes.ok) {
          // If update failed, try upsert (insert)
          const upsertRes = await fetch('/api/v1/privacy_settings', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${(await api.auth.getSession()).data.session?.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: user.id,
              ...dbData,
            }),
          });

          if (!upsertRes.ok) {
            console.error('Upsert also failed:', await upsertRes.text());
          }
        }

        // Always save to localStorage for immediate UI updates
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(updatedSettings));

      } catch (error) {
        console.error('Database save error:', error);
        // Still save to localStorage even if database fails
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(updatedSettings));
      }

    } catch (error) {
      console.error('Error updating privacy settings:', error);
      setPrivacySettings(privacySettings);
    } finally {
      setPrivacyLoading(false);
    }
  };

  const loadGoogleFont = (fontName: string) => {
    // Remove existing Google Font links
    const existingLinks = document.querySelectorAll('link[data-google-font]');
    existingLinks.forEach(link => link.remove());

    if (!fontName.trim()) {
      // Reset to default font
      document.documentElement.style.setProperty('--font-family', '');
      document.body.style.fontFamily = '';
      return;
    }

    // Create new Google Font link
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap`;
    link.rel = 'stylesheet';
    link.setAttribute('data-google-font', 'true');
    document.head.appendChild(link);

    // Apply font to document root and body
    const fontFamily = `"${fontName}", system-ui, -apple-system, sans-serif`;
    document.documentElement.style.setProperty('--font-family', fontFamily);
    document.body.style.fontFamily = fontFamily;
  };

  const handleFontChange = async (fontName: string) => {
    setCustomFont(fontName);
    localStorage.setItem('custom_font', fontName);
    syncSharedAppearanceCookies();

    if (fontName.trim()) {
      loadGoogleFont(fontName);
      // Track font setting change for achievement
      const token = (await api.auth.getSession()).data.session?.access_token;
      await fetch('/api/v1/user_settings_changes', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id,
          setting_name: 'custom_font'
        }),
      });
    } else {
      // Reset to default
      const existingLinks = document.querySelectorAll('link[data-google-font]');
      existingLinks.forEach(link => link.remove());
      document.body.style.fontFamily = '';
      localStorage.removeItem('custom_font');
      syncSharedAppearanceCookies();
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error("Заполните все поля");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Пароль должен быть не менее 6 символов");
      return;
    }

    try {
      const { error } = await api.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast.success("Пароль успешно изменён");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordDialog(false);
    } catch (error: unknown) {
      const errMsg = error && typeof (error as { message?: string }).message === "string" ? (error as { message: string }).message : "неизвестная ошибка";
      toast.error("Ошибка изменения пароля: " + errMsg);
    }
  };

  const handleColorThemeChange = (newColor: ColorTheme) => {
    setThemeState((prev) => ({ ...prev, colorTheme: newColor }));
    localStorage.setItem('color-theme', newColor);
    applyTheme(newColor, isDarkMode);
  };

  const handleDarkModeToggle = (checked: boolean) => {
    setThemeState((prev) => ({ ...prev, isDarkMode: checked }));
    localStorage.setItem('dark-mode', checked.toString());
    applyTheme(colorTheme, checked);
  };

  const handleSenderDisplayTypeChange = (value: 'classic' | 'modern') => {
    setSenderDisplayType(value);
    localStorage.setItem('sender-display-type', value);
  };

  const handleTabChange = (value: string) => {
    navigate(`/settings/${value}`);
  };

  // Initialize theme on component mount (only update if changed)
  useEffect(() => {
    applyTheme(colorTheme, isDarkMode);
  }, [colorTheme, isDarkMode]);

  // Load custom font on component mount
  useEffect(() => {
    const savedFont = localStorage.getItem('custom_font');
    if (savedFont) {
      setCustomFont(savedFont);
      loadGoogleFont(savedFont);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadPrivacySettings();

      // Poll privacy settings every 30s (Go backend doesn't support realtime yet)
      const interval = setInterval(loadPrivacySettings, 30000);
      return () => clearInterval(interval);
    }
  }, [user, loadPrivacySettings]);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <TooltipProvider>
      <main className="max-w-4xl mx-auto p-4">
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Настройки</h1>
              <p className="text-muted-foreground">Настройки профиля и приложения</p>
            </div>

            <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1">
                <TabsTrigger value="appearance" className="text-xs sm:text-sm px-2 py-2">Внешний вид</TabsTrigger>
                <TabsTrigger value="profile" className="text-xs sm:text-sm px-2 py-2">Профиль</TabsTrigger>
                <TabsTrigger value="account" className="text-xs sm:text-sm px-2 py-2">Аккаунт</TabsTrigger>
                <TabsTrigger value="privacy" className="text-xs sm:text-sm px-2 py-2">Приватность</TabsTrigger>
              </TabsList>

              <TabsContent value="appearance" className="space-y-4">
                <div className="bg-card p-4 sm:p-6 border border-border space-y-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Palette className="h-5 w-5" />
                      <div>
                        <h2 className="text-lg font-semibold">Внешний вид</h2>
                        <p className="text-sm text-muted-foreground">Тема применяется сразу и одинаково во всех разделах</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 sm:min-w-[220px]">
                      <Label htmlFor="dark-mode" className="text-sm font-semibold">
                        Тёмный режим
                      </Label>
                      <Switch
                        id="dark-mode"
                        checked={isDarkMode}
                        onCheckedChange={handleDarkModeToggle}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {themeOptions.map((theme) => {
                      const isSelected = colorTheme === theme.id;

                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleColorThemeChange(theme.id)}
                          className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-300 ${
                            isSelected
                              ? "border-primary/70 bg-primary/8 shadow-[0_0_0_1px_hsl(var(--primary)/0.22),0_10px_28px_hsl(var(--primary)/0.1)]"
                              : "border-border bg-background/60 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/30 hover:shadow-md"
                          }`}
                        >
                          <div
                            className={`absolute inset-0 opacity-0 transition-opacity duration-300 ${
                              isSelected ? "opacity-100" : "group-hover:opacity-100"
                            }`}
                            style={{
                              background: `radial-gradient(circle at top right, ${theme.accent}22, transparent 45%)`,
                            }}
                          />
                          <div className="relative space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="font-semibold leading-tight">{theme.name}</div>
                                <div className="text-xs text-muted-foreground">{theme.description}</div>
                              </div>
                              <span
                                className={`h-3 w-3 rounded-full border border-white/20 transition-all duration-300 ${
                                  isSelected ? "scale-110 ring-4 ring-primary/15" : "group-hover:scale-105"
                                }`}
                                style={{ backgroundColor: theme.accent, boxShadow: isSelected ? `0 0 14px ${theme.accent}44` : `0 0 10px ${theme.accent}22` }}
                              />
                            </div>
                            <div
                              className={`h-20 rounded-xl border border-white/10 transition-transform duration-300 ${
                                isSelected ? "scale-[1.005]" : "group-hover:scale-[1.005]"
                              }`}
                              style={{ background: theme.preview }}
                            >
                              <div className="flex h-full items-end justify-between gap-2 p-3">
                                <div className="space-y-2">
                                  <span className="block h-2.5 w-20 rounded-full bg-white/80" />
                                  <span className="block h-2.5 w-12 rounded-full bg-white/55" />
                                </div>
                                <span
                                  className="block h-9 w-9 rounded-xl border border-white/20"
                                  style={{ backgroundColor: theme.accent, boxShadow: `0 0 20px ${theme.accent}55` }}
                                />
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font Panel */}
                    <Collapsible open={fontSettingsExpanded} onOpenChange={setFontSettingsExpanded}>
                      <CollapsibleTrigger asChild>
                    <button className="w-full bg-card border border-border p-4 sm:p-6 text-left flex items-center justify-between hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                        <Type className="h-5 w-5" />
                        <span className="text-lg font-semibold">Шрифт</span>
                          </div>
                      <ChevronDown className={`h-5 w-5 transition-transform ${fontSettingsExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </CollapsibleTrigger>

                  <CollapsibleContent className="space-y-4 pt-4 sm:pt-6">
                    <div className="bg-card border border-border p-4 sm:p-6">
                        <div>
                          <Label htmlFor="google-font" className="text-sm font-medium">
                            Шрифт из Google Fonts
                          </Label>
                          <div className="mt-2 space-y-2">
                            <Input
                              id="google-font"
                              type="text"
                              placeholder="Введите название шрифта (например: Roboto, Open Sans, Montserrat)"
                              value={customFont}
                              onChange={(e) => handleFontChange(e.target.value)}
                              className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                              Введите точное название шрифта из{' '}
                              <a
                                href="https://fonts.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                Google Fonts
                              </a>
                              . Например: "Roboto", "Open Sans", "Montserrat", "Lato" и т.д.
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Оставьте поле пустым, чтобы использовать шрифт по умолчанию.
                            </p>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>


              </TabsContent>

              <TabsContent value="profile" className="space-y-4">
                {/* Profile Customization */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Кастомизация профиля</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Основная кастомизация</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Настройте никнейм, аватар, био и другие элементы профиля
                      </p>
                      <Link to={`/profile/${user.id}`}>
                        <Button variant="outline">
                          Перейти в профиль
                        </Button>
                      </Link>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Уникальная кастомизация</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Расширенные настройки внешнего вида профиля
                      </p>
                      <Button
                        variant="default"
                        onClick={() => navigate("/settings/custom")}
                      >
                        Настроить
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Post Customization */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Кастомизация постов</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Внешний вид постов</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Настройте как выглядят ваши посты в треддах
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/settings/posts")}
                      >
                        Настроить
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Interface Settings */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Интерфейс постов</h2>
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm font-medium mb-3 block">Вид отправителя</Label>
                                <div className="flex gap-4">
                                <div className="flex-1">
                                  <Select value={senderDisplayType} onValueChange={handleSenderDisplayTypeChange}>
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="classic">Классический</SelectItem>
                                      <SelectItem value="modern">Современный</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex-1 bg-muted/30 border border-border p-3 rounded text-xs">
                                  {senderDisplayType === 'classic' ? (
                                    <>
                                      <div className="font-mono text-primary">#03136507</div>
                                      <div className="text-muted-foreground">· nickname · 2 дня назад</div>
                                    </>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center text-xs">👤</div>
                                      <div>
                                        <div className="text-muted-foreground">nickname</div>
                                        <div className="text-muted-foreground">2 дня назад</div>
                                        <div className="font-mono text-primary text-[10px]">#03136507</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                          </div>
                        </div>
                  </div>

                {/* Placeholders */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Плейсхолдеры</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Плейсхолдеры профиля</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Выберите плейсхолдеры для отображения при наведении на пользователя
                      </p>
                        <Button
                          variant="outline"
                          onClick={() => navigate("/settings/placeholders")}
                        >
                          Настроить
                        </Button>
                      </div>
                    </div>
                </div>
              </TabsContent>

              <TabsContent value="account" className="space-y-4">
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Аккаунт</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Профиль</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Управление информацией профиля
                      </p>
                      <Link to={`/profile/${user.id}`}>
                        <Button variant="outline">
                          Перейти в профиль
                        </Button>
                      </Link>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Пароль</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Измените пароль для защиты аккаунта
                      </p>
                      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
                        <DialogTrigger asChild>
                          <Button variant="outline">
                            Сменить пароль
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Изменить пароль</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <Input
                              type="password"
                              placeholder="Новый пароль"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <Input
                              type="password"
                              placeholder="Подтвердите новый пароль"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <Button onClick={handlePasswordChange} className="w-full">
                              Изменить пароль
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Passkeys Section */}
                    <div className="border-t border-border pt-4 mt-4">
                      <PasskeysSettings />
                    </div>

                    {/* 2FA Section */}
                    <div className="border-t border-border pt-4 mt-4">
                      <h3 className="text-lg font-semibold mb-2">Двухфакторная аутентификация (2FA)</h3>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Защитите ваш аккаунт с помощью TOTP кода из аутентификатора
                      </p>
                      <TwoFASection userId={user.id} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-4">
                    {/* Private Profile */}
                    <div className="bg-card p-4 sm:p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">Приватный профиль</h2>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Скрывает контент профиля от пользователей, которые не являются вашими друзьями</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Приватный режим</span>
                          </div>
                          <Switch
                            checked={privacySettings.private_profile}
                            onCheckedChange={(value) => updatePrivacySetting('private_profile', value)}
                            disabled={privacyLoading}
                          />
                        </div>

                        <div className={`space-y-3 pl-4 border-l-2 ${privacySettings.private_profile ? 'border-primary/30' : 'border-border opacity-50'}`}>
                          <div className="flex items-center justify-between">
                            <span>Скрывать аватар</span>
                            <Switch
                              checked={privacySettings.private_hide_avatar}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_avatar', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать стену</span>
                            <Switch
                              checked={privacySettings.private_hide_wall}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_wall', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать треды</span>
                            <Switch
                              checked={privacySettings.private_hide_threads}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_threads', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать статистику</span>
                            <Switch
                              checked={privacySettings.private_hide_stats}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_stats', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать список друзей</span>
                            <Switch
                              checked={privacySettings.private_hide_friends}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_friends', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать подарки</span>
                            <Switch
                              checked={privacySettings.private_hide_gifts}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_gifts', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Скрывать достижения</span>
                            <Switch
                              checked={privacySettings.private_hide_achievements}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_achievements', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Visibility */}
                    <div className="bg-card p-4 sm:p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">Видимость</h2>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>Показывать статус "В сети"</span>
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Показывать статус "В сети" когда вы активны</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={privacySettings.show_online_status ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('show_online_status', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Показывать статистику в профиле</span>
                          <Switch
                            checked={privacySettings.show_profile_stats ?? false}
                            onCheckedChange={(value) => updatePrivacySetting('show_profile_stats', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Показывать подробную статистику (/stats)</span>
                          <Switch
                            checked={privacySettings.show_detailed_stats ?? false}
                            onCheckedChange={(value) => updatePrivacySetting('show_detailed_stats', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Показывать стену профиля</span>
                          <Switch
                            checked={privacySettings.show_profile_wall ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('show_profile_wall', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Разрешить посты от других</span>
                          <Switch
                            checked={privacySettings.allow_wall_posts_from_others ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('allow_wall_posts_from_others', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Security */}
                    <div className="bg-card p-4 sm:p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">Безопасность</h2>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>Удалять метаданные с изображений</span>
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Удаляет EXIF данные (геолокация, время съемки) для защиты приватности</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={privacySettings.remove_image_metadata ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('remove_image_metadata', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                      </div>
                    </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>

    </TooltipProvider>
  );
};

export default Settings;
