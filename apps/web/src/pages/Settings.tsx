import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { ChevronDown, HelpCircle, Type, Palette, Music, Trash2, Send } from "lucide-react";
import { TwoFASection } from "@/components/TwoFASection";
import { PasskeysSettings } from "@/components/PasskeysSettings";
import { SessionsSettings } from "@/components/SessionsSettings";
import NotificationsSettings from "@/components/NotificationsSettings";
import { applyTheme, DEFAULT_DARK_MODE, DEFAULT_THEME, type ColorTheme, getStoredTheme, syncSharedAppearanceCookies } from "@/utils/theme";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PublishButton } from "@/components/PublishButton";
import { PUBLISH_BUTTON_STYLES, getPublishButtonStyle, setPublishButtonStyle, type PublishButtonStyle } from "@/lib/publishButtonStyle";


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
  // H3 (security audit): these three toggles now apply to PUBLIC profiles too.
  // DB defaults are FALSE (migrations 082/083) and existing public rows were
  // backfilled to FALSE, so the defaults here must match — otherwise new users
  // would be created with hidden walls/avatars/stats they never asked for.
  private_hide_avatar: false,
  private_hide_wall: false,
  private_hide_threads: true,
  private_hide_stats: false,
  private_hide_friends: true,
  private_hide_gifts: true,
  private_hide_achievements: true,
};

const themeOptions: Array<{
  id: ColorTheme;
  nameKey: string;
  descriptionKey: string;
  accent: string;
  preview: string;
}> = [
  { id: "graphite", nameKey: "themeGraphite", descriptionKey: "themeGraphiteDescription", accent: "#0078D7", preview: "linear-gradient(135deg, #1E1E1E 0%, #2D2D2D 50%, #3C3C3C 100%)" },
  { id: "lavender", nameKey: "themeLavender", descriptionKey: "themeLavenderDescription", accent: "#C6A9FF", preview: "linear-gradient(135deg, #1A1625 0%, #2D2440 55%, #B0FFE6 130%)" },
  { id: "volcanic", nameKey: "themeVolcanic", descriptionKey: "themeVolcanicDescription", accent: "#FF4D00", preview: "linear-gradient(135deg, #1F1F1F 0%, #2A2422 50%, #FF4D00 140%)" },
  { id: "mint", nameKey: "themeMint", descriptionKey: "themeMintDescription", accent: "#00FFA3", preview: "linear-gradient(135deg, #F0FFF4 0%, #E6FFF1 55%, #F5FF7A 120%)" },
  { id: "glitch", nameKey: "themeGlitch", descriptionKey: "themeGlitchDescription", accent: "#00FFFF", preview: "linear-gradient(135deg, #121212 0%, #1D1D1D 50%, #2A1030 100%)" },
  { id: "acid", nameKey: "themeAcid", descriptionKey: "themeAcidDescription", accent: "#39FF14", preview: "linear-gradient(135deg, #000000 0%, #081507 45%, #FF10F0 130%)" },
  { id: "void", nameKey: "themeVoid", descriptionKey: "themeVoidDescription", accent: "#FFFFFF", preview: "linear-gradient(135deg, #000000 0%, #101010 45%, #4A4A4A 100%)" },
  { id: "cannabis", nameKey: "themeCannabis", descriptionKey: "themeCannabisDescription", accent: "#3FA34D", preview: "linear-gradient(135deg, #1E2A1E 0%, #315C31 100%)" },
  { id: "pink", nameKey: "themePink", descriptionKey: "themePinkDescription", accent: "#FF4FA3", preview: "linear-gradient(135deg, #2A1722 0%, #7C2B5B 100%)" },
  { id: "blue", nameKey: "themeBlue", descriptionKey: "themeBlueDescription", accent: "#4D7CFE", preview: "linear-gradient(135deg, #172033 0%, #27496D 100%)" },
  { id: "blood", nameKey: "themeBlood", descriptionKey: "themeBloodDescription", accent: "#D62839", preview: "linear-gradient(135deg, #2A1113 0%, #701B26 100%)" },
  { id: "pumpkin", nameKey: "themePumpkin", descriptionKey: "themePumpkinDescription", accent: "#FF8A00", preview: "linear-gradient(135deg, #2B190C 0%, #8C4A0F 100%)" },
];

const Settings = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [themesExpanded, setThemesExpanded] = useState(false);
  const [fontSettingsExpanded, setFontSettingsExpanded] = useState(false);
  const [publishButtonExpanded, setPublishButtonExpanded] = useState(false);
  const [publishButtonStyle, setPublishButtonStyleState] = useState<PublishButtonStyle>(getPublishButtonStyle);

  const [customFont, setCustomFont] = useState(() => {
    return localStorage.getItem('custom_font') || '';
  });
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Spotify integration state
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyName, setSpotifyName] = useState<string | null>(null);
  const [spotifyAvatar, setSpotifyAvatar] = useState<string | null>(null);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyAuthUrl, setSpotifyAuthUrl] = useState<string | null>(null);

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
  const settingsTabs = useMemo(() => ["appearance", "profile", "account", "privacy", "notifications", "integrations"] as const, []);
  const currentTab = useMemo(() => {
    const pathPart = location.pathname.split("/")[2] || "appearance";
    return settingsTabs.includes(pathPart as (typeof settingsTabs)[number]) ? pathPart : "appearance";
  }, [location.pathname, settingsTabs]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await api.auth.getUser();
      setUser(user);
      
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
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t("settings.passwordFieldsRequired"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordsMismatch"));
      return;
    }

    if (newPassword.length < 6) {
      toast.error(t("settings.passwordMinLength"));
      return;
    }

    try {
      const { error } = await api.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });

      if (error) throw error;

      toast.success(t("settings.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordDialog(false);
    } catch (error: unknown) {
      const errMsg = error && typeof (error as { message?: string }).message === "string" ? (error as { message: string }).message : t("settings.unknownError");
      toast.error(t("settings.passwordChangeError", { error: errMsg }));
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

  const handlePublishButtonStyleChange = (style: PublishButtonStyle) => {
    setPublishButtonStyleState(style);
    setPublishButtonStyle(style);
  };

  const handleTabChange = (value: string) => {
    navigate(`/settings/${value}`);
  };

  // Spotify integration handlers
  const loadSpotifyStatus = useCallback(async () => {
    if (!user) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/v1/integrations/spotify/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSpotifyConnected(data.connected);
      setSpotifyName(data.spotify_name || null);
      setSpotifyAvatar(data.spotify_avatar || null);
    } catch {
      // ignore
    }
  }, [user]);

  const handleSpotifyConnect = async () => {
    if (!user) return;
    setSpotifyLoading(true);
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/v1/integrations/spotify/auth-url', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t("settings.spotifyNotConfigured"));
        return;
      }
      if (data.auth_url) {
        setSpotifyAuthUrl(data.auth_url);
      } else {
        toast.error(t("settings.spotifyAuthUrlError"));
      }
    } catch {
      toast.error(t("settings.spotifyConnectError"));
    } finally {
      setSpotifyLoading(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    if (!user) return;
    setSpotifyLoading(true);
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/v1/integrations/spotify/disconnect', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSpotifyConnected(false);
        setSpotifyName(null);
        setSpotifyAvatar(null);
        setSpotifyAuthUrl(null);
        toast.success(t("settings.spotifyDisconnected"));
      } else {
        toast.error(t("settings.spotifyDisconnectError"));
      }
    } catch {
      toast.error(t("settings.spotifyDisconnectError"));
    } finally {
      setSpotifyLoading(false);
    }
  };

  // Load Spotify status on mount and check URL params for callback messages
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('spotify_status');
    const message = params.get('spotify_message');
    if (status === 'success') {
      toast.success(message || t("settings.spotifyConnected"));
      // Clean URL
      window.history.replaceState({}, '', location.pathname);
    } else if (status === 'error') {
      toast.error(message || t("settings.spotifyConnectError"));
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location.pathname, location.search, t]);

  useEffect(() => {
    if (user) {
      loadSpotifyStatus();
    }
  }, [user, loadSpotifyStatus]);

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
              <h1 className="text-2xl font-bold mb-2">{t("settings.title")}</h1>
              <p className="text-muted-foreground">{t("settings.subtitle")}</p>
            </div>

            <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto p-1">
                <TabsTrigger value="appearance" className="text-xs sm:text-sm px-2 py-2">{t("settings.appearance")}</TabsTrigger>
                <TabsTrigger value="profile" className="text-xs sm:text-sm px-2 py-2">{t("settings.profile")}</TabsTrigger>
                <TabsTrigger value="account" className="text-xs sm:text-sm px-2 py-2">{t("settings.account")}</TabsTrigger>
                <TabsTrigger value="privacy" className="text-xs sm:text-sm px-2 py-2">{t("settings.privacy")}</TabsTrigger>
                <TabsTrigger value="notifications" className="text-xs sm:text-sm px-2 py-2">{t("settings.notifications")}</TabsTrigger>
                <TabsTrigger value="integrations" className="text-xs sm:text-sm px-2 py-2">{t("settings.integrations")}</TabsTrigger>
              </TabsList>

              <TabsContent value="appearance" className="space-y-4">
                {/* Язык интерфейса */}
                <LanguageSelector userId={user?.id ?? null} />
                <div className="bg-card border border-border p-4 sm:p-6">
                  <h2 className="text-lg font-semibold mb-2">{t("settings.translations")}</h2>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("settings.translationsDescription")}
                  </p>
                  <Link to="/translate">
                    <Button variant="outline">{t("settings.openTranslationEditor")}</Button>
                  </Link>
                </div>

                {/* Темы — сворачиваемая секция */}
                <Collapsible open={themesExpanded} onOpenChange={setThemesExpanded}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full bg-card border border-border p-4 sm:p-6 text-left flex items-center justify-between hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Palette className="h-5 w-5" />
                        <div>
                          <span className="text-lg font-semibold">{t("settings.themes")}</span>
                          <p className="text-sm text-muted-foreground">{t("settings.themesDescription")}</p>
                        </div>
                      </div>
                      <ChevronDown className={`h-5 w-5 transition-transform ${themesExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-4">
                    <div className="bg-card border border-border p-4 sm:p-6 space-y-6">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 sm:min-w-[220px]">
                    <Label htmlFor="dark-mode" className="text-sm font-semibold">
                      {t("settings.darkMode")}
                    </Label>
                    <Switch
                      id="dark-mode"
                      checked={isDarkMode}
                      onCheckedChange={handleDarkModeToggle}
                    />
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
                                <div className="font-semibold leading-tight">{t(`settings.${theme.nameKey}`)}</div>
                                <div className="text-xs text-muted-foreground">{t(`settings.${theme.descriptionKey}`)}</div>
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
                  </CollapsibleContent>
                </Collapsible>

                {/* Font Panel */}
                    <Collapsible open={fontSettingsExpanded} onOpenChange={setFontSettingsExpanded}>
                      <CollapsibleTrigger asChild>
                    <button className="w-full bg-card border border-border p-4 sm:p-6 text-left flex items-center justify-between hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                        <Type className="h-5 w-5" />
                        <span className="text-lg font-semibold">{t("settings.font")}</span>
                          </div>
                      <ChevronDown className={`h-5 w-5 transition-transform ${fontSettingsExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </CollapsibleTrigger>

                  <CollapsibleContent className="space-y-4 pt-4 sm:pt-6">
                    <div className="bg-card border border-border p-4 sm:p-6">
                        <div>
                          <Label htmlFor="google-font" className="text-sm font-medium">
                            {t("settings.googleFont")}
                          </Label>
                          <div className="mt-2 space-y-2">
                            <Input
                              id="google-font"
                              type="text"
                              placeholder={t("settings.googleFontPlaceholder")}
                              value={customFont}
                              onChange={(e) => handleFontChange(e.target.value)}
                              className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                              {t("settings.googleFontHint")}
                              <a
                                href="https://fonts.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                Google Fonts
                              </a>
                              . {t("settings.googleFontExamples")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("settings.googleFontEmptyHint")}
                            </p>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Publish button style */}
                <Collapsible open={publishButtonExpanded} onOpenChange={setPublishButtonExpanded}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full bg-card border border-border p-4 sm:p-6 text-left flex items-center justify-between hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Send className="h-5 w-5" />
                        <span className="text-lg font-semibold">Кнопка публикации</span>
                      </div>
                      <ChevronDown className={`h-5 w-5 transition-transform ${publishButtonExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-4 sm:pt-6">
                    <div className="bg-card border border-border p-4 sm:p-6 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Стиль кнопки «Опубликовать» в редакторе записи g-саба.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {PUBLISH_BUTTON_STYLES.map((s) => {
                          const isSelected = publishButtonStyle === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handlePublishButtonStyleChange(s.id)}
                              className={`group relative rounded-2xl border p-3 text-left transition-all duration-200 ${
                                isSelected
                                  ? "border-primary/70 bg-primary/8 shadow-[0_0_0_1px_hsl(var(--primary)/0.22),0_10px_28px_hsl(var(--primary)/0.1)]"
                                  : "border-border bg-background/60 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/30 hover:shadow-md"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-semibold leading-tight">{s.label}</div>
                                  <div className="text-xs text-muted-foreground">{s.description}</div>
                                </div>
                                <span
                                  className={`h-3 w-3 shrink-0 rounded-full border transition-all duration-200 ${
                                    isSelected ? "scale-110 bg-primary ring-4 ring-primary/15" : "border-foreground/20"
                                  }`}
                                />
                              </div>
                              <div className="mt-3 flex min-h-[52px] items-center justify-center rounded-xl border border-border/60 bg-background/50 p-2">
                                <PublishButton style={s.id} onClick={() => {}} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

              </TabsContent>

              <TabsContent value="profile" className="space-y-4">
                {/* Profile Customization */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">{t("settings.profileCustomization")}</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t("settings.mainCustomization")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.mainCustomizationDescription")}
                      </p>
                      <Link to={`/profile/${user.id}`}>
                        <Button variant="outline">{t("settings.goToProfile")}</Button>
                      </Link>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("settings.profileStudio")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.profileStudioDescription")}
                      </p>
                      <Button
                        variant="default"
                        onClick={() => navigate("/settings/prof-studio")}>{t("settings.openStudio")}</Button>
                    </div>
                  </div>
                </div>

                {/* Post Customization */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">{t("settings.postCustomization")}</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t("settings.postAppearance")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.postAppearanceDescription")}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/settings/posts")}>{t("settings.configure")}</Button>
                    </div>
                  </div>
                </div>

                {/* Interface Settings */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">{t("settings.postInterface")}</h2>
                          <div className="space-y-4">
                            <div>
                              <Label className="text-sm font-medium mb-3 block">{t("settings.senderDisplay")}</Label>
                                <div className="flex gap-4">
                                <div className="flex-1">
                                  <Select value={senderDisplayType} onValueChange={handleSenderDisplayTypeChange}>
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="classic">{t("settings.classic")}</SelectItem>
                                      <SelectItem value="modern">{t("settings.modern")}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex-1 bg-muted/30 border border-border p-3 rounded text-xs">{senderDisplayType === 'classic' ? (
                                      <>
                                      <div className="font-mono text-primary">#03136507</div>
                                      <div className="text-muted-foreground">· nickname · {t("time.daysShort", { count: 2 })}</div>
                                    </>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center text-xs">👤</div>
                                      <div>
                                        <div className="text-muted-foreground">nickname</div>
                                        <div className="text-muted-foreground">{t("time.daysShort", { count: 2 })}</div>
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
                  <h2 className="text-lg font-semibold mb-4">{t("settings.placeholders")}</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t("settings.profilePlaceholders")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.profilePlaceholdersDescription")}
                      </p>
                        <Button
                          variant="outline"
                          onClick={() => navigate("/settings/placeholders")}
                        >
                          {t("settings.configure")}
                        </Button>
                      </div>
                    </div>
                </div>
              </TabsContent>

              <TabsContent value="account" className="space-y-4">
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">{t("settings.account")}</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t("settings.profile")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.accountProfileDescription")}
                      </p>
                      <Link to={`/profile/${user.id}`}>
                        <Button variant="outline">{t("settings.goToProfile")}</Button>
                      </Link>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t("settings.password")}</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.passwordDescription")}
                      </p>
                      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
                        <DialogTrigger asChild>
                          <Button variant="outline">
                            {t("settings.changePassword")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t("settings.changePassword")}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <Input
                              type="password"
                              placeholder={t("auth.currentPassword")}
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                            <Input
                              type="password"
                              placeholder={t("auth.newPassword")}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <Input
                              type="password"
                              placeholder={t("settings.confirmNewPassword")}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <Button onClick={handlePasswordChange} className="w-full">
                              {t("settings.changePassword")}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Passkeys Section */}
                    <div className="border-t border-border pt-4 mt-4">
                      <PasskeysSettings />
                    </div>

                    {/* Sessions Section */}
                    <div className="border-t border-border pt-4 mt-4">
                      <SessionsSettings />
                    </div>

                    {/* 2FA Section */}
                    <div className="border-t border-border pt-4 mt-4">
                      <h3 className="text-lg font-semibold mb-2">{t("settings.twoFactor")}</h3>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t("settings.twoFactorDescription")}
                      </p>
                      <TwoFASection userId={user.id} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notifications" className="space-y-4">
                <NotificationsSettings />
              </TabsContent>

              <TabsContent value="integrations" className="space-y-4">
                {/* Spotify Integration */}
                <div className="bg-card p-4 sm:p-6 border border-border">
                  <div className="flex items-center gap-2 mb-4">
                    <Music className="h-5 w-5 text-[#1DB954]" />
                    <div>
                      <h2 className="text-lg font-semibold">Spotify</h2>
                      <p className="text-sm text-muted-foreground">
                        {spotifyConnected
                          ? t("settings.spotifyConnectedAs", { name: spotifyName || "Spotify" })
                          : t("settings.spotifyDescription")}
                      </p>
                    </div>
                  </div>

                  {spotifyLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <PentagramLoader size="sm" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {spotifyConnected ? (
                        <>
                          {spotifyAvatar && (
                            <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg border border-border">
                              <img
                                src={spotifyAvatar}
                                alt={t("settings.spotifyAvatarAlt")}
                                className="w-10 h-10 rounded-full"
                              />
                              <div>
                                <p className="font-medium text-sm">{spotifyName || "Spotify"}</p>
                                <p className="text-xs text-muted-foreground">{t("settings.connected")}</p>
                              </div>
                            </div>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleSpotifyDisconnect}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            {t("settings.disconnectSpotify")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">
                            {t("settings.spotifyDescriptionLong")}
                          </p>
                          {spotifyAuthUrl ? (
                            <div className="space-y-3">
                              <p className="text-sm">
                                {t("settings.spotifyAuthorizeHint")}
                              </p>
                              <Button
                                onClick={() => window.location.href = spotifyAuthUrl}
                                className="gap-2 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold"
                              >
                                <Music className="h-4 w-4" />
                                {t("settings.connectSpotify")}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              onClick={handleSpotifyConnect}
                              className="gap-2 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold"
                            >
                              <Music className="h-4 w-4" />
                              {t("settings.connectSpotify")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-4">
                    {/* Private Profile */}
                    <div className="bg-card p-4 sm:p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">{t("settings.privateProfile")}</h2>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("settings.privateProfileDescription")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{t("settings.privateMode")}</span>
                          </div>
                          <Switch
                            checked={privacySettings.private_profile}
                            onCheckedChange={(value) => updatePrivacySetting('private_profile', value)}
                            disabled={privacyLoading}
                          />
                        </div>

                        <div className={`space-y-3 pl-4 border-l-2 ${privacySettings.private_profile ? 'border-primary/30' : 'border-border opacity-50'}`}>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideAvatar")}</span>
                            <Switch
                              checked={privacySettings.private_hide_avatar}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_avatar', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span>{t("settings.hideWall")}</span>
                              <Tooltip>
                                <TooltipTrigger>
                                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t("settings.hideWallHint")}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Switch
                              checked={privacySettings.private_profile ? true : privacySettings.private_hide_wall}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_wall', value)}
                              disabled={privacyLoading || privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideThreads")}</span>
                            <Switch
                              checked={privacySettings.private_hide_threads}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_threads', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideStats")}</span>
                            <Switch
                              checked={privacySettings.private_hide_stats}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_stats', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideFriends")}</span>
                            <Switch
                              checked={privacySettings.private_hide_friends}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_friends', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideGifts")}</span>
                            <Switch
                              checked={privacySettings.private_hide_gifts}
                              onCheckedChange={(value) => updatePrivacySetting('private_hide_gifts', value)}
                              disabled={privacyLoading || !privacySettings.private_profile}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span>{t("settings.hideAchievements")}</span>
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
                        <h2 className="text-lg font-semibold">{t("settings.visibility")}</h2>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{t("settings.showOnlineStatus")}</span>
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("settings.showOnlineStatusHint")}</p>
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
                          <span>{t("settings.showProfileStats")}</span>
                          <Switch
                            checked={privacySettings.show_profile_stats ?? false}
                            onCheckedChange={(value) => updatePrivacySetting('show_profile_stats', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{t("settings.showDetailedStats")}</span>
                          <Switch
                            checked={privacySettings.show_detailed_stats ?? false}
                            onCheckedChange={(value) => updatePrivacySetting('show_detailed_stats', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{t("settings.showProfileWall")}</span>
                          <Switch
                            checked={privacySettings.show_profile_wall ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('show_profile_wall', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{t("settings.allowWallPosts")}</span>
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
                        <h2 className="text-lg font-semibold">{t("settings.security")}</h2>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{t("settings.removeMetadata")}</span>
                            <Tooltip>
                              <TooltipTrigger>
                                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("settings.removeMetadataHint")}</p>
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
