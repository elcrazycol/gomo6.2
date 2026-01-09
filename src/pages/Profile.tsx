import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { Footer } from "@/components/Footer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Camera, Edit2, LogOut, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Profile {
  id: string;
  username: string;
  bio: string | null;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  created_at: string;
  avatar_url?: string | null;
  account_number?: number | null;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlocked_at: string;
}

const Profile = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);
        
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setCurrentUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) {
      const loadAll = async () => {
        setPageLoading(true);
        await Promise.all([
          loadProfile(),
          loadAchievements(),
        ]);
        setPageLoading(false);
      };
      loadAll();
    }
  }, [userId]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (data) {
      setProfile(data);
      setUsername(data.username);
      setBio(data.bio || "");
      setIsAnonymous(data.is_anonymous);
      setAvatarUrl(data.avatar_url);
    }
  };

  const loadAchievements = async () => {
    const { data } = await supabase
      .from("user_achievements")
      .select(`
        unlocked_at,
        achievements (
          id,
          name,
          description,
          icon,
          category
        )
      `)
      .eq("user_id", userId)
      .order("unlocked_at", { ascending: false });

    if (data) {
      setAchievements(
        data.map((ua: any) => ({
          ...ua.achievements,
          unlocked_at: ua.unlocked_at,
        }))
      );
    }
  };

  const handleSave = async () => {
    if (!currentUser || currentUser.id !== userId) return;

    // Сохраняем профиль
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        username,
        bio,
        is_anonymous: isAnonymous,
      })
      .eq("id", userId);

    if (profileError) {
      toast.error("Ошибка сохранения профиля");
      return;
    }

    // Смена пароля, если поле заполнено
    if (newPassword) {
      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (passwordError) {
        toast.error("Ошибка смены пароля");
        return;
      } else {
        toast.success("Пароль успешно изменён");
        setNewPassword("");
      }
    }

    toast.success("Профиль обновлен");
    setIsEditing(false);
    loadProfile();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/avatar_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (error) throw error;

      setAvatarUrl(publicUrl);
      toast.success("Аватар обновлен");
    } catch (error) {
      toast.error("Ошибка загрузки аватара");
      console.error(error);
    }
  };

  const handlePasswordChange = async () => {
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

      toast.success("Пароль изменен");
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error("Ошибка изменения пароля");
      console.error(error);
    }
  };

  const handleUsernameChange = async () => {
    if (newUsername !== confirmUsername) {
      toast.error("Имена пользователя не совпадают");
      return;
    }

    if (newUsername.length < 3) {
      toast.error("Имя пользователя должно быть не менее 3 символов");
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ username: newUsername })
        .eq("id", userId);

      if (error) throw error;

      toast.success("Имя пользователя изменено");
      setProfile(prev => prev ? { ...prev, username: newUsername } : null);
      setUsername(newUsername);
      setShowUsernameDialog(false);
      setNewUsername("");
      setConfirmUsername("");
    } catch (error) {
      toast.error("Ошибка изменения имени пользователя");
      console.error(error);
    }
  };

  if (pageLoading || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const isOwnProfile = currentUser?.id === userId;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <Link to="/" className="text-xl font-bold hover:underline flex-shrink-0">
            gomo6
          </Link>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <ThemeToggle />
            {currentUser && <NotificationBell userId={currentUser.id} />}
            {currentUser && <ChatIcon userId={currentUser.id} />}
            {currentUser ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                  {isModerator && (
                    <Link to="/moderation">
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                    </Link>
                  )}
                </div>
                <MobileMenu
                  user={currentUser}
                  isModerator={isModerator}
                  username={profile?.username}
                  isAnonymous={profile?.is_anonymous}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile Header */}
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-10 h-10 text-muted-foreground" />
                  )}
                </div>
                {isOwnProfile && (
                  <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors">
                    <Camera className="w-4 h-4 text-primary-foreground" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{profile.username}</h1>
                  {isOwnProfile && (
                    <Dialog open={showUsernameDialog} onOpenChange={setShowUsernameDialog}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="p-1 h-6 w-6">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Изменить имя пользователя</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <Input
                            placeholder="Новое имя пользователя"
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                          />
                          <Input
                            placeholder="Подтвердите новое имя пользователя"
                            value={confirmUsername}
                            onChange={(e) => setConfirmUsername(e.target.value)}
                          />
                          <Button onClick={handleUsernameChange} className="w-full">
                            Изменить имя пользователя
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  ID: {profile.id.slice(0, 8)} {profile.account_number && `(${profile.account_number})`}
                </p>
                {profile.bio && (
                  <p className="text-sm text-muted-foreground">{profile.bio}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                {!isOwnProfile && currentUser && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate(`/messages?user=${userId}`)}
                  >
                    Написать
                  </Button>
                )}
                {isOwnProfile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(!isEditing)}
                  >
                    {isEditing ? "Отмена" : "Редактировать"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <Label>О себе</Label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Расскажите о себе..."
                  rows={4}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="anonymous"
                  checked={isAnonymous}
                  onCheckedChange={setIsAnonymous}
                />
                <Label htmlFor="anonymous">
                  Режим анонимности (писать как "Аноним")
                </Label>
              </div>

              <div className="flex gap-2">
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

                <Button onClick={handleSave}>Сохранить изменения</Button>
              </div>

              {/* Logout button */}
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  onClick={handleLogout}
                  className="w-full"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Выйти из аккаунта
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-card rounded-lg border">
                <div className="text-2xl font-bold">{profile.thread_count || 0}</div>
                <div className="text-sm text-muted-foreground">Тредов</div>
              </div>
              <div className="text-center p-4 bg-card rounded-lg border">
                <div className="text-2xl font-bold">{profile.post_count || 0}</div>
                <div className="text-sm text-muted-foreground">Постов</div>
              </div>
            </div>
          )}

          {/* Registration date */}
          {!isEditing && (
            <div className="text-center text-sm text-muted-foreground">
              Регистрация: {formatDistanceToNow(new Date(profile.created_at), {
                locale: ru,
                addSuffix: true,
              })}
            </div>
          )}

          <div>
            <h2 className="text-xl font-bold mb-4">
              Достижения ({achievements.length})
            </h2>
            {achievements.length === 0 ? (
              <p className="text-muted-foreground">Достижений пока нет</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {achievements.map((achievement) => (
                  <div
                    key={achievement.id}
                    className="bg-post-header border border-border p-3 flex items-start gap-3"
                  >
                    <span className="text-3xl">{achievement.icon}</span>
                    <div className="flex-1">
                      <p className="font-bold">{achievement.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {achievement.description}
                      </p>
                      <p className="text-xs text-primary mt-1">
                        {new Date(achievement.unlocked_at).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;
