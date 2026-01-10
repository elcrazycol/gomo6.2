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
import { ThemeToggle } from "@/components/ThemeToggle";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
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
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropScale, setCropScale] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [minScale, setMinScale] = useState(0.5);
  const [maxScale, setMaxScale] = useState(3);

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

    // Convert file to data URL for cropping
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCropImage(event.target.result as string);
        setCropScale(1);
        setCropOffset({ x: 0, y: 0 });

        // Calculate min/max scale for this image
        const img = new Image();
        img.onload = () => {
          const containerSize = 256;
          const cropRadius = 96;

          // Min scale: circle should fit in the smallest dimension
          const minScaleNeeded = Math.max(
            (cropRadius * 2) / Math.min(img.width, img.height),
            0.1
          );
          setMinScale(minScaleNeeded);

          // Max scale: allow up to 3x or until circle fills the container
          const maxScalePossible = Math.min(
            3,
            containerSize / Math.min(img.width, img.height)
          );
          setMaxScale(maxScalePossible);
        };
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async () => {
    if (!cropImage || !userId) return;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = async () => {
        canvas.width = 200;
        canvas.height = 200;

        // Calculate crop area
        const size = Math.min(img.width, img.height) / cropScale;
        const x = (img.width - size) / 2 + cropOffset.x;
        const y = (img.height - size) / 2 + cropOffset.y;

        // Draw cropped and resized image
        ctx?.drawImage(img, x, y, size, size, 0, 0, 200, 200);

        // Convert to blob
        canvas.toBlob(async (blob) => {
          if (blob) {
            const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            const fileName = `${userId}/avatar_${Date.now()}.jpg`;

            const { error: uploadError } = await supabase.storage
              .from('post-images')
              .upload(fileName, croppedFile);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
              .from('post-images')
              .getPublicUrl(fileName);

            const { error } = await supabase
              .from("profiles")
              .update({ avatar_url: publicUrl })
              .eq("id", userId);

            if (error) throw error;

            setAvatarUrl(publicUrl);
            setCropImage(null);
            toast.success("Аватар обновлен");
          }
        }, 'image/jpeg', 0.9);
      };

      img.src = cropImage;
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

  const handleSaveAndExit = async () => {
    try {
      // Save bio changes
      if (userId && bio !== profile.bio) {
        const { error: bioError } = await supabase
          .from("profiles")
          .update({ bio })
          .eq("id", userId);

        if (bioError) throw bioError;
      }

      // Save username changes
      if (userId && newUsername.trim() && newUsername !== profile.username) {
        const { error: usernameError } = await supabase
          .from("profiles")
          .update({ username: newUsername.trim() })
          .eq("id", userId);

        if (usernameError) throw usernameError;

        setProfile(prev => prev ? { ...prev, username: newUsername.trim() } : null);
      }

      // Save anonymity setting
      if (userId && isAnonymous !== profile.is_anonymous) {
        const { error: anonError } = await supabase
          .from("profiles")
          .update({ is_anonymous: isAnonymous })
          .eq("id", userId);

        if (anonError) throw anonError;
      }

      setIsEditing(false);
      setNewUsername("");
      toast.success("Изменения сохранены");
    } catch (error) {
      toast.error("Ошибка сохранения изменений");
      console.error(error);
    }
  };

  const startEditing = () => {
    setNewUsername(profile.username);
    setBio(profile.bio || "");
    setIsAnonymous(profile.is_anonymous);
    setIsEditing(true);
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
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const isOwnProfile = currentUser?.id === userId;

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1">
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

      <main className="max-w-2xl mx-auto p-4">
        <div className="space-y-6">
          {/* Profile Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
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
                {isOwnProfile && isEditing && (
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
                  {isEditing && isOwnProfile ? (
                    <Input
                      value={newUsername || profile.username}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="text-2xl font-bold h-auto p-0 border-none bg-transparent"
                      placeholder="Никнейм"
                    />
                  ) : (
                    <h1 className="text-2xl font-bold">{profile.username}</h1>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  ID: {profile.id.slice(0, 8)} {profile.account_number && `(${profile.account_number})`}
                </p>
              </div>
            </div>

            {/* Edit Button */}
            {isOwnProfile && (
              <Button
                variant="ghost"
                size="sm"
                className="p-1 h-8 w-8"
                onClick={isEditing ? handleSaveAndExit : startEditing}
              >
                {isEditing ? (
                  <span className="text-green-500 text-lg">✓</span>
                ) : (
                  <Edit2 className="w-4 h-4" />
                )}
              </Button>
            )}

            {/* Write Button for other users */}
            {!isOwnProfile && currentUser && (
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate(`/messages?user=${userId}`)}
                className="text-xs sm:text-sm"
              >
                Написать
              </Button>
            )}
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

              {/* Avatar Crop Dialog */}
              <Dialog open={!!cropImage} onOpenChange={() => setCropImage(null)}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Кадрирование аватара</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="relative w-full h-64 bg-muted rounded-lg overflow-hidden">
                      {cropImage && (
                        <div
                          className="relative w-full h-full cursor-move"
                          onMouseDown={(e) => {
                            const startX = e.clientX - cropOffset.x;
                            const startY = e.clientY - cropOffset.y;

                            const handleMouseMove = (e: MouseEvent) => {
                              const img = new Image();
                              img.src = cropImage!;
                              img.onload = () => {
                                // Container size (256px)
                                const containerSize = 256;

                                // Calculate how the image fits in the container with current scale
                                const scaledImgWidth = img.width * cropScale;
                                const scaledImgHeight = img.height * cropScale;

                                // The image will be scaled down if it's larger than container
                                const scaleX = containerSize / scaledImgWidth;
                                const scaleY = containerSize / scaledImgHeight;
                                const finalScale = Math.min(1, Math.min(scaleX, scaleY));

                                // Final display size of the image
                                const displayWidth = scaledImgWidth * finalScale;
                                const displayHeight = scaledImgHeight * finalScale;

                                // Circle radius (96px for 192px diameter circle)
                                const cropRadius = 96;

                                // Simple bounds: circle center must stay within display image bounds minus crop radius
                                const maxOffsetX = Math.max(0, (displayWidth / 2) - cropRadius);
                                const maxOffsetY = Math.max(0, (displayHeight / 2) - cropRadius);

                                const newX = Math.max(-maxOffsetX, Math.min(maxOffsetX, e.clientX - startX));
                                const newY = Math.max(-maxOffsetY, Math.min(maxOffsetY, e.clientY - startY));

                                setCropOffset({ x: newX, y: newY });
                              };
                            };

                            const handleMouseUp = () => {
                              document.removeEventListener('mousemove', handleMouseMove);
                              document.removeEventListener('mouseup', handleMouseUp);
                            };

                            document.addEventListener('mousemove', handleMouseMove);
                            document.addEventListener('mouseup', handleMouseUp);
                          }}
                          onTouchStart={(e) => {
                            e.preventDefault();
                            const touch = e.touches[0];
                            const startX = touch.clientX - cropOffset.x;
                            const startY = touch.clientY - cropOffset.y;

                            let lastDistance = 0;

                            const handleTouchMove = (e: TouchEvent) => {
                              e.preventDefault();

                              if (e.touches.length === 2) {
                                // Pinch to zoom
                                const touch1 = e.touches[0];
                                const touch2 = e.touches[1];
                                const distance = Math.sqrt(
                                  Math.pow(touch2.clientX - touch1.clientX, 2) +
                                  Math.pow(touch2.clientY - touch1.clientY, 2)
                                );

                                if (lastDistance > 0) {
                                  const scaleChange = distance / lastDistance;
                                  const newScale = Math.max(0.5, Math.min(3, cropScale * scaleChange));
                                  setCropScale(newScale);
                                }
                                lastDistance = distance;
                              } else if (e.touches.length === 1) {
                                // Drag
                                const img = new Image();
                                img.src = cropImage!;
                                img.onload = () => {
                                // Container size (256px)
                                const containerSize = 256;

                                // Calculate how the image fits in the container with current scale
                                const scaledImgWidth = img.width * cropScale;
                                const scaledImgHeight = img.height * cropScale;

                                // The image will be scaled down if it's larger than container
                                const scaleX = containerSize / scaledImgWidth;
                                const scaleY = containerSize / scaledImgHeight;
                                const finalScale = Math.min(1, Math.min(scaleX, scaleY));

                                // Final display size of the image
                                const displayWidth = scaledImgWidth * finalScale;
                                const displayHeight = scaledImgHeight * finalScale;

                                  // Circle radius (96px for 192px diameter circle)
                                  const cropRadius = 96;

                                  // Simple bounds: circle center must stay within display image bounds minus crop radius
                                  const maxOffsetX = Math.max(0, (displayWidth / 2) - cropRadius);
                                  const maxOffsetY = Math.max(0, (displayHeight / 2) - cropRadius);

                                  const newX = Math.max(-maxOffsetX, Math.min(maxOffsetX, touch.clientX - startX));
                                  const newY = Math.max(-maxOffsetY, Math.min(maxOffsetY, touch.clientY - startY));

                                  setCropOffset({ x: newX, y: newY });
                                };
                              }
                            };

                            const handleTouchEnd = () => {
                              document.removeEventListener('touchmove', handleTouchMove);
                              document.removeEventListener('touchend', handleTouchEnd);
                            };

                            document.addEventListener('touchmove', handleTouchMove, { passive: false });
                            document.addEventListener('touchend', handleTouchEnd);
                          }}
                        >
                          <img
                            src={cropImage}
                            alt="Crop preview"
                            className="absolute top-1/2 left-1/2 max-w-full max-h-full"
                            style={{
                              transform: `translate(-50%, -50%) scale(${cropScale}) translate(${cropOffset.x}px, ${cropOffset.y}px)`,
                              transformOrigin: 'center',
                            }}
                          />
                          {/* Crop circle overlay */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-48 h-48 rounded-full border-2 border-white shadow-lg"></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Масштаб: {cropScale.toFixed(1)}x</Label>
                      <input
                        type="range"
                        min={minScale}
                        max={maxScale}
                        step="0.1"
                        value={cropScale}
                        onChange={(e) => {
                          const newScale = Math.max(minScale, Math.min(maxScale, parseFloat(e.target.value)));
                          setCropScale(newScale);

                          // Adjust crop offset to stay within bounds at new scale
                          if (cropImage) {
                            const img = new Image();
                            img.onload = () => {
                              const containerSize = 256;
                              const scaledImgWidth = img.width * newScale;
                              const scaledImgHeight = img.height * newScale;
                              const scaleX = containerSize / scaledImgWidth;
                              const scaleY = containerSize / scaledImgHeight;
                              const finalScale = Math.min(1, Math.min(scaleX, scaleY));
                              const displayWidth = scaledImgWidth * finalScale;
                              const displayHeight = scaledImgHeight * finalScale;
                              const cropRadius = 96;

                              // Recalculate bounds and adjust offset
                              const maxOffsetX = Math.max(0, (displayWidth / 2) - cropRadius);
                              const maxOffsetY = Math.max(0, (displayHeight / 2) - cropRadius);

                              setCropOffset(prev => ({
                                x: Math.max(-maxOffsetX, Math.min(maxOffsetX, prev.x)),
                                y: Math.max(-maxOffsetY, Math.min(maxOffsetY, prev.y))
                              }));
                            };
                            img.src = cropImage;
                          }
                        }}
                        className="w-full"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={() => setCropImage(null)} variant="outline" className="flex-1">
                        Отмена
                      </Button>
                      <Button onClick={handleCropConfirm} className="flex-1">
                        Сохранить
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>



              {/* Password change button */}
              <div className="pt-4 border-t">
                <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full">
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

              {/* Logout button */}
              <Button
                variant="destructive"
                onClick={handleLogout}
                className="w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Выйти из аккаунта
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {profile.bio && <p className="text-sm">{profile.bio}</p>}

              <div className="grid grid-cols-2 gap-4 p-4 bg-post-header border border-border">
                <div>
                  <p className="text-sm text-muted-foreground">Тредов создано</p>
                  <p className="text-2xl font-bold">{profile.thread_count}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Постов написано</p>
                  <p className="text-2xl font-bold">{profile.post_count}</p>
                </div>
              </div>

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
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};

export default Profile;
