import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, HelpCircle, AlertTriangle, Type } from "lucide-react";

const Settings = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [privacySettings, setPrivacySettings] = useState<any>(null);

  interface PrivacySettingsData {
    visibility_profile: boolean;
    hide_messages_from_unregistered: boolean;
    hide_threads_from_unregistered: boolean;
    block_profile_visits_from_unregistered: boolean;
    allow_search_by_username: boolean;
    allow_search_by_id: boolean;
    allow_search_by_secondary_id: boolean;
    allow_private_messages: boolean;
    anonymous_mode: boolean;
    remove_image_metadata: boolean;
  }
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [visibilityExpanded, setVisibilityExpanded] = useState(false);
  const [showAnonymousConfirm, setShowAnonymousConfirm] = useState(false);
  const [fontSettingsExpanded, setFontSettingsExpanded] = useState(false);
  const [customFont, setCustomFont] = useState(() => {
    return localStorage.getItem('custom_font') || '';
  });
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value);

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

  const loadPrivacySettings = async () => {
    // Always try to load from database first for consistency across devices
    try {
      const { data, error } = await (supabase as any)
        .from('privacy_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!error && data) {
        // Data exists in database - use it and cache in localStorage
        setPrivacySettings(data);
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(data));
        return;
      }

      // If no data in database (new user), create default settings
      if (error && error.code === 'PGRST116') {
        console.log('Creating default privacy settings for user');
        const defaultSettings = {
          user_id: user.id,
          visibility_profile: true,
          hide_messages_from_unregistered: false,
          hide_threads_from_unregistered: false,
          block_profile_visits_from_unregistered: false,
          allow_search_by_username: true,
          allow_search_by_id: true,
          allow_search_by_secondary_id: true,
          allow_private_messages: true,
          anonymous_mode: false,
          remove_image_metadata: true,
        };

        const { error: insertError, data: insertedData } = await (supabase as any)
          .from('privacy_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (!insertError && insertedData) {
          setPrivacySettings(insertedData);
          localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(insertedData));
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
        setPrivacySettings(parsedSettings);
        console.log('Loaded privacy settings from localStorage');
        return;
      } catch (error) {
        console.error('Error parsing saved privacy settings:', error);
      }
    }

    // Last resort: use hardcoded defaults
    const defaultSettings = {
      visibility_profile: true,
      hide_messages_from_unregistered: false,
      hide_threads_from_unregistered: false,
      block_profile_visits_from_unregistered: false,
      allow_search_by_username: true,
      allow_search_by_id: true,
      allow_search_by_secondary_id: true,
      allow_private_messages: true,
      anonymous_mode: false,
      remove_image_metadata: true,
    };
    setPrivacySettings(defaultSettings);
    console.log('Using default privacy settings');
  };

  const updatePrivacySetting = async (key: string, value: boolean) => {
    if (!privacySettings || !user) return;

    setPrivacyLoading(true);
    try {
      const updatedSettings = { ...privacySettings, [key]: value };
      setPrivacySettings(updatedSettings);

      // Prepare data for database (exclude user_id and any extra fields)
      const dbData = {
        visibility_profile: updatedSettings.visibility_profile,
        hide_messages_from_unregistered: updatedSettings.hide_messages_from_unregistered,
        hide_threads_from_unregistered: updatedSettings.hide_threads_from_unregistered,
        block_profile_visits_from_unregistered: updatedSettings.block_profile_visits_from_unregistered,
        allow_search_by_username: updatedSettings.allow_search_by_username,
        allow_search_by_id: updatedSettings.allow_search_by_id,
        allow_search_by_secondary_id: updatedSettings.allow_search_by_secondary_id,
        allow_private_messages: updatedSettings.allow_private_messages,
        anonymous_mode: updatedSettings.anonymous_mode,
        remove_image_metadata: updatedSettings.remove_image_metadata,
      };

      // Try to save to database
      try {
        // First try to update existing record
        const { error: updateError } = await (supabase as any)
          .from('privacy_settings')
          .update(dbData)
          .eq('user_id', user.id);

        if (updateError) {
          console.log('Update failed, trying upsert:', updateError);
          // If update failed, try upsert (insert or update)
          const { error: upsertError } = await (supabase as any)
            .from('privacy_settings')
            .upsert({
              user_id: user.id,
              ...dbData,
            });

          if (upsertError) {
            console.error('Upsert also failed:', upsertError);
          }
        }

        // Always save to localStorage for immediate UI updates
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(updatedSettings));

      } catch (error) {
        console.error('Database save error:', error);
        // Still save to localStorage even if database fails
        localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(updatedSettings));
      }

      console.log('Privacy setting updated:', key, value);
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      setPrivacySettings(privacySettings);
    } finally {
      setPrivacyLoading(false);
    }
  };

  const handleAnonymousToggle = async (value: boolean) => {
    if (value && !privacySettings?.anonymous_mode) {
      setShowAnonymousConfirm(true);
    } else {
      await updatePrivacySetting('anonymous_mode', value);
    }
  };

  const confirmAnonymousMode = async () => {
    await updatePrivacySetting('anonymous_mode', true);
    setShowAnonymousConfirm(false);
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

    if (fontName.trim()) {
      loadGoogleFont(fontName);
      // Track font setting change for achievement
      await supabase
        .from('user_settings_changes')
        .upsert({
          user_id: user?.id,
          setting_name: 'custom_font'
        }, {
          onConflict: 'user_id,setting_name'
        });
    } else {
      // Reset to default
      const existingLinks = document.querySelectorAll('link[data-google-font]');
      existingLinks.forEach(link => link.remove());
      document.body.style.fontFamily = '';
      localStorage.removeItem('custom_font');
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
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast.success("Пароль успешно изменён");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordDialog(false);
    } catch (error: any) {
      toast.error("Ошибка изменения пароля: " + error.message);
    }
  };

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

      // Set up real-time subscription for privacy settings changes
      const channel = (supabase as any)
        .channel(`privacy_settings_${user.id}`)
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'privacy_settings',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
            console.log('Privacy settings updated from another device:', payload);
            // Update local state and localStorage
            const updatedSettings = payload.new;
            setPrivacySettings(updatedSettings);
            localStorage.setItem(`privacy_settings_${user.id}`, JSON.stringify(updatedSettings));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

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
      <div className="bg-background min-h-screen flex flex-col">
        <div className="flex-1">
          <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
              <Link to="/" className="text-xl font-bold hover:underline flex-shrink-0">
                gomo6
              </Link>
              <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
                <ThemeToggle />
                {user && <NotificationBell userId={user.id} />}
                {user && <ChatIcon userId={user.id} />}
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                  <ProfileHoverCard userId={user.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`text-sm sm:text-base hover:bg-white/20 hover:text-white transition-colors drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${
                        currentUserColor === 'purple' ? 'text-purple-500' :
                        currentUserColor === 'gold' ? 'text-yellow-500' :
                        currentUserColor === 'orange' ? 'text-orange-500' :
                        currentUserColor === 'red' ? 'text-red-500' :
                        currentUserColor === 'blue' ? 'text-blue-500' :
                        currentUserColor === 'green' ? 'text-green-500' :
                        currentUserColor === 'yellow' ? 'text-yellow-400' :
                        currentUserColor === 'cyan' ? 'text-cyan-500' :
                        'text-quote'
                      }`}
                      onClick={() => navigate(`/profile/${user.id}`)}
                    >
                      {currentUserUsername || 'Профиль'}
                    </Button>
                  </ProfileHoverCard>
                </div>
                <MobileMenu user={user} isModerator={false} />
              </div>
            </div>
          </header>

        <main className="max-w-4xl mx-auto p-4">
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Настройки</h1>
              <p className="text-muted-foreground">Настройки профиля и приложения</p>
            </div>

            <Tabs defaultValue="appearance" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="general">Основные</TabsTrigger>
                <TabsTrigger value="appearance">Внешний вид</TabsTrigger>
                <TabsTrigger value="account">Аккаунт</TabsTrigger>
                <TabsTrigger value="privacy">Приватность</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Основные настройки</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Язык</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Настройки языка находятся в разработке
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Часовой пояс</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Автоматическое определение часового пояса
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="appearance" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Внешний вид</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Тема</label>
                      <div className="mt-2">
                        <ThemeToggle />
                      </div>
                    </div>

                    <Collapsible open={fontSettingsExpanded} onOpenChange={setFontSettingsExpanded}>
                      <CollapsibleTrigger asChild>
                        <button className="w-full flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <Type className="h-4 w-4" />
                            <span className="text-sm font-medium">Настройки шрифта</span>
                          </div>
                          <ChevronDown className={`h-4 w-4 transition-transform ${fontSettingsExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="space-y-4 pt-4">
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
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="account" className="space-y-4">
                <div className="bg-card p-6 border border-border">
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
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-4">
                {privacySettings && (
                  <>
                    {/* Profile Visibility Section */}
                    <div className="bg-card border border-border">
                      <button
                        onClick={() => setVisibilityExpanded(!visibilityExpanded)}
                        className="w-full p-6 text-left flex items-center justify-between hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold">Видимость профиля</span>
                          <HelpCircle className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <ChevronDown className={`h-5 w-5 transition-transform ${visibilityExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {visibilityExpanded && (
                        <div className="px-6 pb-6 space-y-6">
                          <div>
                            <h3 className="text-base font-medium mb-4">Общая видимость</h3>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Не показывать сообщения <u>НП</u></span>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>НП - незарегистрированный пользователь</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                                <Switch
                                  checked={privacySettings.hide_messages_from_unregistered}
                                  onCheckedChange={(value) => updatePrivacySetting('hide_messages_from_unregistered', value)}
                                  disabled={privacyLoading}
                                />
                              </div>

                              <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Не показывать мои треды <u>НП</u></span>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>НП - незарегистрированный пользователь</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                                <Switch
                                  checked={privacySettings.hide_threads_from_unregistered}
                                  onCheckedChange={(value) => updatePrivacySetting('hide_threads_from_unregistered', value)}
                                  disabled={privacyLoading}
                                />
                              </div>

                              <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Запретить посещать мой профиль <u>НП</u></span>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>НП - незарегистрированный пользователь</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                                <Switch
                                  checked={privacySettings.block_profile_visits_from_unregistered}
                                  onCheckedChange={(value) => updatePrivacySetting('block_profile_visits_from_unregistered', value)}
                                  disabled={privacyLoading}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Private Chat Section */}
                    <div className="bg-card p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">Личный чат</h2>
                        <AlertTriangle className="h-4 w-4 text-orange-500 cursor-help" />
                        <span className="text-xs text-muted-foreground">(экспериментальная функция)</span>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span>Поиск меня по username</span>
                          <Switch
                            checked={privacySettings.allow_search_by_username}
                            onCheckedChange={(value) => updatePrivacySetting('allow_search_by_username', value)}
                            disabled={privacyLoading}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Поиск меня по ID</span>
                          <Switch
                            checked={privacySettings.allow_search_by_id}
                            onCheckedChange={(value) => updatePrivacySetting('allow_search_by_id', value)}
                            disabled={privacyLoading}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Поиск меня по 2nd ID</span>
                          <Switch
                            checked={privacySettings.allow_search_by_secondary_id}
                            onCheckedChange={(value) => updatePrivacySetting('allow_search_by_secondary_id', value)}
                            disabled={privacyLoading}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span>Разрешить писать мне сообщения</span>
                          <Switch
                            checked={privacySettings.allow_private_messages}
                            onCheckedChange={(value) => updatePrivacySetting('allow_private_messages', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Image Security Section */}
                    <div className="bg-card p-6 border border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-semibold">Безопасность изображений</h2>
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
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
                                <p>Удаляет EXIF данные (геолокация, время съемки и др.) для защиты приватности</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={privacySettings.remove_image_metadata ?? true}
                            onCheckedChange={(value) => updatePrivacySetting('remove_image_metadata', value)}
                            disabled={privacyLoading}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Рекомендуется оставить включенным для защиты вашей приватности.
                          Метаданные могут содержать информацию о местоположении и времени съемки.
                        </p>
                      </div>
                    </div>

                    {/* Anonymous Mode */}
                    <div className="bg-card p-6 border border-border border-red-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-red-600">Режим анонимности</h2>
                          <p className="text-sm text-muted-foreground mt-1">
                            Не рекомендуется включать
                          </p>
                        </div>
                        <Switch
                          checked={privacySettings.anonymous_mode}
                          onCheckedChange={handleAnonymousToggle}
                          disabled={privacyLoading}
                          className="data-[state=checked]:bg-red-500"
                        />
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      {/* Anonymous Mode Confirmation Dialog */}
      <Dialog open={showAnonymousConfirm} onOpenChange={setShowAnonymousConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Включить режим анонимности?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">
              Вы уверены, что хотите включить режим анонимности?
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4">
              <li>• Информация о вашей активности не будет собираться</li>
              <li>• Достижения не будут получены</li>
              <li>• Вам никто не сможет написать лично при надобности</li>
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowAnonymousConfirm(false)}>
                Отмена
              </Button>
              <Button variant="destructive" onClick={confirmAnonymousMode}>
                Включить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default Settings;