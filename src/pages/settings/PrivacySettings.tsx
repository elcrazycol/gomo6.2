import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, ChevronDown, HelpCircle, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PentagramLoader } from "@/components/PentagramLoader";

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
  show_threads_tab: boolean;
  show_profile_wall?: boolean;
  allow_wall_posts_from_others?: boolean;
  show_profile_stats?: boolean;
  show_detailed_stats?: boolean;
}

const PrivacySettings = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [settings, setSettings] = useState<PrivacySettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visibilityExpanded, setVisibilityExpanded] = useState(false);
  const [showAnonymousConfirm, setShowAnonymousConfirm] = useState(false);
  const defaultSettings: PrivacySettingsData = {
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
    show_threads_tab: true,
    show_profile_wall: true,
    allow_wall_posts_from_others: true,
    show_profile_stats: false,
    show_detailed_stats: false,
  };

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (user) {
      loadPrivacySettings();

      // Set up real-time subscription for privacy settings changes
      const channel = supabase
        .channel(`privacy_settings_${user.id}`)
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'privacy_settings',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('Privacy settings updated from another device:', payload);
            // Update local state
            setSettings(payload.new);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadPrivacySettings = async () => {
    try {
      const { data, error } = await supabase
        .from('privacy_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('Error loading privacy settings:', error);
        return;
      }

      if (data) {
        setSettings({
          ...defaultSettings,
          ...data,
        });
      } else {
        // Create default settings if none exist
        setSettings(defaultSettings);
      }
    } catch (error) {
      console.error('Error loading privacy settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof PrivacySettingsData, value: boolean | Record<string, boolean>) => {
    if (!settings || !user) return;

    setSaving(true);
    try {
      const updatedSettings = { ...settings, [key]: value };
      setSettings(updatedSettings);

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
        show_threads_tab: updatedSettings.show_threads_tab ?? true,
        show_profile_wall: updatedSettings.show_profile_wall ?? true,
        allow_wall_posts_from_others: updatedSettings.allow_wall_posts_from_others ?? true,
        show_profile_stats: updatedSettings.show_profile_stats ?? false,
        show_detailed_stats: updatedSettings.show_detailed_stats ?? false,
      };

      const { error } = await supabase
        .from('privacy_settings')
        .upsert({
          user_id: user.id,
          ...dbData,
        });

      if (error) {
        console.error('Error updating privacy settings:', error);
        // Revert on error
        setSettings(settings);
      }
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  const handleAnonymousToggle = async (value: boolean) => {
    if (value && !settings?.anonymous_mode) {
      setShowAnonymousConfirm(true);
    } else {
      await updateSetting('anonymous_mode', value);
    }
  };

  const metricLabels: Record<string, string> = {
    garma: "gарма",
    posts: "Посты",
    threads: "Треды",
    postLikes: "Лайки постов",
    threadLikes: "Лайки тредов",
    replies: "Ответы в моих тредах",
    time: "Время на сайте",
  };

  const confirmAnonymousMode = async () => {
    await updateSetting('anonymous_mode', true);
    setShowAnonymousConfirm(false);
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user || !settings) {
    navigate("/auth");
    return null;
  }

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1">
        <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
          <div className="max-w-5xl mx-auto flex items-center gap-4">
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Приватность</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto p-4">
          <div className="space-y-6">
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
                          <HelpCircle
                            className="h-4 w-4 text-muted-foreground cursor-help"
                            title="НП - незарегистрированный пользователь"
                          />
                        </div>
                        <Switch
                          checked={settings.hide_messages_from_unregistered}
                          onCheckedChange={(value) => updateSetting('hide_messages_from_unregistered', value)}
                          disabled={saving}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Не показывать мои треды <u>НП</u></span>
                          <HelpCircle
                            className="h-4 w-4 text-muted-foreground cursor-help"
                            title="НП - незарегистрированный пользователь"
                          />
                        </div>
                        <Switch
                          checked={settings.hide_threads_from_unregistered}
                          onCheckedChange={(value) => updateSetting('hide_threads_from_unregistered', value)}
                          disabled={saving}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Запретить посещать мой профиль <u>НП</u></span>
                          <HelpCircle
                            className="h-4 w-4 text-muted-foreground cursor-help"
                            title="НП - незарегистрированный пользователь"
                          />
                        </div>
                        <Switch
                          checked={settings.block_profile_visits_from_unregistered}
                          onCheckedChange={(value) => updateSetting('block_profile_visits_from_unregistered', value)}
                          disabled={saving}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Показывать вкладку тредов в профиле</span>
                          <HelpCircle
                            className="h-4 w-4 text-muted-foreground cursor-help"
                            title="Показывать вкладку с вашими тредами в профиле"
                          />
                        </div>
                        <Switch
                          checked={settings.show_threads_tab ?? true}
                          onCheckedChange={(value) => updateSetting('show_threads_tab', value)}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stats Privacy */}
            <div className="bg-card p-6 border border-border">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold">Статистика</h2>
                <HelpCircle className="h-4 w-4 text-muted-foreground" title="Управление тем, что видят другие в /stats" />
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Показывать статистику в профиле</span>
                  <Switch
                    checked={settings.show_profile_stats ?? false}
                    onCheckedChange={(value) => updateSetting('show_profile_stats', value)}
                    disabled={saving}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Показывать подробную статистику</span>
                  <Switch
                    checked={settings.show_detailed_stats ?? false}
                    onCheckedChange={(value) => updateSetting('show_detailed_stats', value)}
                    disabled={saving}
                  />
                </div>
              </div>
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
                    checked={settings.allow_search_by_username}
                    onCheckedChange={(value) => updateSetting('allow_search_by_username', value)}
                    disabled={saving}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span>Поиск меня по ID</span>
                  <Switch
                    checked={settings.allow_search_by_id}
                    onCheckedChange={(value) => updateSetting('allow_search_by_id', value)}
                    disabled={saving}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span>Поиск меня по 2nd ID</span>
                  <Switch
                    checked={settings.allow_search_by_secondary_id}
                    onCheckedChange={(value) => updateSetting('allow_search_by_secondary_id', value)}
                    disabled={saving}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span>Разрешить писать мне сообщения</span>
                  <Switch
                    checked={settings.allow_private_messages}
                    onCheckedChange={(value) => updateSetting('allow_private_messages', value)}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            {/* Profile Wall Section */}
            <div className="bg-card p-6 border border-border">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold">Стена профиля</h2>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>Показывать стену профиля</span>
                    <HelpCircle
                      className="h-4 w-4 text-muted-foreground cursor-help"
                      title="Если отключено, никто не увидит стену на вашем профиле"
                    />
                  </div>
                  <Switch
                    checked={settings.show_profile_wall}
                    onCheckedChange={(value) => updateSetting('show_profile_wall', value)}
                    disabled={saving}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>Разрешить писать на стене другим пользователям</span>
                    <HelpCircle
                      className="h-4 w-4 text-muted-foreground cursor-help"
                      title="Если отключено, только вы сможете оставлять посты на своей стене"
                    />
                  </div>
                  <Switch
                    checked={settings.allow_wall_posts_from_others}
                    onCheckedChange={(value) => updateSetting('allow_wall_posts_from_others', value)}
                    disabled={saving}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  На стене профиля пользователи могут оставлять посты с текстом, изображениями и заголовками.
                </p>
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
                    <HelpCircle
                      className="h-4 w-4 text-muted-foreground cursor-help"
                      title="Удаляет EXIF данные (геолокация, время съемки и др.) для защиты приватности"
                    />
                  </div>
                  <Switch
                    checked={settings.remove_image_metadata}
                    onCheckedChange={(value) => updateSetting('remove_image_metadata', value)}
                    disabled={saving}
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
                  checked={settings.anonymous_mode}
                  onCheckedChange={handleAnonymousToggle}
                  disabled={saving}
                  className="data-[state=checked]:bg-red-500"
                />
              </div>
            </div>
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
  );
};

export default PrivacySettings;
