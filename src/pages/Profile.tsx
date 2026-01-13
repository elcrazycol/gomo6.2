import { useEffect, useState, useRef } from "react";
import React from "react";
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
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { Camera, Edit2, LogOut, User, Settings } from "lucide-react";
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

interface AvatarCropperProps {
  imageSrc: string;
  onCropComplete: (croppedImage: string) => void;
  onCancel: () => void;
}

const AvatarCropper: React.FC<AvatarCropperProps> = ({ imageSrc, onCropComplete, onCancel }) => {
  // Элементы DOM (React refs)
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Переменные для работы с изображением (точная копия из оригинального кода)
  const [originalImage, setOriginalImage] = useState<string>('');
  const [circleRadius, setCircleRadius] = useState(150);
  const [circleX, setCircleX] = useState(0);
  const [circleY, setCircleY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartY, setDragStartY] = useState(0);
  const [circleStartX, setCircleStartX] = useState(0);
  const [circleStartY, setCircleStartY] = useState(0);
  const [scale, setScale] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);

  const canvasWidth = 400;
  const canvasHeight = 400;

  // Загрузка изображения (точная копия из оригинального кода)
  useEffect(() => {
    setOriginalImage(imageSrc);
    loadImage(imageSrc);
  }, [imageSrc]);

  // Функция загрузки изображения (точная копия)
  const loadImage = (src: string) => {
    const img = new Image();
    img.onload = function() {
      // Рассчитываем масштаб для отображения изображения в канвасе
      const newScale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
      setScale(newScale);

      // Устанавливаем начальную позицию круга по центру канваса
      setCircleX(canvasWidth / 2);
      setCircleY(canvasHeight / 2);

      setImageLoaded(true);
      drawImageAndCircle();
    };

    img.src = src;
  };

  // Отрисовка изображения и круга (точная копия из оригинального кода)
  const drawImageAndCircle = () => {
    if (!imageCanvasRef.current || !imageLoaded) return;

    const ctx = imageCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Очищаем канвас
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Вычисляем размеры изображения с учетом масштаба
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;

      // Вычисляем позицию для центрирования изображения
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;

      // Рисуем изображение
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

      // Рисуем обрезанную область (круг) для предпросмотра
      ctx.save();
      ctx.beginPath();
      ctx.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      ctx.restore();

      // Рисуем границу круга
      ctx.beginPath();
      ctx.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3498db';
      ctx.stroke();

      // Рисуем перекрестие в центре круга
      const crossSize = 10;
      ctx.beginPath();
      ctx.moveTo(circleX - crossSize, circleY);
      ctx.lineTo(circleX + crossSize, circleY);
      ctx.moveTo(circleX, circleY - crossSize);
      ctx.lineTo(circleX, circleY + crossSize);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3498db';
      ctx.stroke();
    };
    img.src = originalImage;
  };

  // Обновление отрисовки при изменении параметров
  useEffect(() => {
    if (imageLoaded) {
      drawImageAndCircle();
    }
  }, [circleX, circleY, circleRadius, imageLoaded, scale]);

  // Обработчики событий для изменения размера круга
  const handleCircleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newRadius = parseInt(e.target.value);
    setCircleRadius(newRadius);
  };

  // Конвертация координат из видимого размера в внутренний размер canvas
  const convertCanvasCoordinates = (clientX: number, clientY: number) => {
    if (!imageCanvasRef.current) return { x: 0, y: 0 };

    const rect = imageCanvasRef.current.getBoundingClientRect();
    // Canvas всегда квадратный (400x400), поэтому используем один масштаб
    const scale = canvasWidth / rect.width;

    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;

    return { x, y };
  };

  // Обработчики событий для перетаскивания круга
  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = convertCanvasCoordinates(e.clientX, e.clientY);
    const x = coords.x;
    const y = coords.y;

    // Проверяем, находится ли курсор внутри круга
    const distance = Math.sqrt((x - circleX) ** 2 + (y - circleY) ** 2);

    if (distance <= circleRadius) {
      setIsDragging(true);
      setDragStartX(x);
      setDragStartY(y);
      setCircleStartX(circleX);
      setCircleStartY(circleY);
      if (imageCanvasRef.current) {
        imageCanvasRef.current.style.cursor = 'grabbing';
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !imageCanvasRef.current) return;

    const coords = convertCanvasCoordinates(e.clientX, e.clientY);
    const x = coords.x;
    const y = coords.y;

    let newCircleX = circleStartX + (x - dragStartX);
    let newCircleY = circleStartY + (y - dragStartY);

    // Ограничиваем движение круга в пределах канваса
    const img = new Image();
    img.onload = () => {
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;

      // Проверяем границы изображения
      const minX = offsetX + circleRadius;
      const maxX = offsetX + scaledWidth - circleRadius;
      const minY = offsetY + circleRadius;
      const maxY = offsetY + scaledHeight - circleRadius;

      if (newCircleX < minX) newCircleX = minX;
      if (newCircleX > maxX) newCircleX = maxX;
      if (newCircleY < minY) newCircleY = minY;
      if (newCircleY > maxY) newCircleY = maxY;

      setCircleX(newCircleX);
      setCircleY(newCircleY);
    };
    img.src = originalImage;
  };

  const handleMouseUp = () => {
    if (isDragging && imageCanvasRef.current) {
      setIsDragging(false);
      imageCanvasRef.current.style.cursor = 'default';
    }
  };

  // Глобальные обработчики событий
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);


  // Сброс настроек к начальным
  const handleReset = () => {
    if (originalImage) {
      setCircleRadius(150);
      loadImage(originalImage);
    }
  };

  // Создание обрезанного аватара (точная копия из оригинального кода)
  const handleCrop = () => {
    if (!imageLoaded) return;

    // Создаем временный канвас для сохранения
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    // Устанавливаем размеры для высококачественного аватара
    const avatarSize = 300; // Размер итогового аватара
    tempCanvas.width = avatarSize;
    tempCanvas.height = avatarSize;

    // Рассчитываем координаты для обрезки
    const img = new Image();
    img.onload = () => {
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;

      const sourceX = (circleX - offsetX - circleRadius) / scale;
      const sourceY = (circleY - offsetY - circleRadius) / scale;
      const sourceSize = (circleRadius * 2) / scale;

      // Обрезаем изображение в форме круга
      tempCtx.save();
      tempCtx.beginPath();
      tempCtx.arc(avatarSize/2, avatarSize/2, avatarSize/2, 0, Math.PI * 2);
      tempCtx.clip();

      // Рисуем обрезанное изображение
      tempCtx.drawImage(
        img,
        sourceX, sourceY, sourceSize, sourceSize,
        0, 0, avatarSize, avatarSize
      );

      tempCtx.restore();

      const croppedImage = tempCanvas.toDataURL('image/png');
      onCropComplete(croppedImage);
    };
    img.src = originalImage;
  };

  return (
    <div className="space-y-4">
      <div className="relative w-full aspect-square max-w-md mx-auto bg-muted rounded-lg overflow-hidden">
        <canvas
          ref={imageCanvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="block w-full h-auto max-w-full bg-gray-900 rounded-lg shadow-lg"
          onMouseDown={handleMouseDown}
          style={{
            cursor: isDragging ? 'grabbing' : 'default',
            aspectRatio: '1'
          }}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Размер круга</label>
        <input
          type="range"
          id="circleSize"
          min="50"
          max="300"
          value={circleRadius}
          onChange={handleCircleSizeChange}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer touch-manipulation"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${((circleRadius - 50) / 250) * 100}%, hsl(var(--muted)) ${((circleRadius - 50) / 250) * 100}%, hsl(var(--muted)) 100%)`
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Маленький</span>
          <span>Размер: {circleRadius}px</span>
          <span>Большой</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={onCancel} variant="outline" className="flex-1">
          Отмена
        </Button>
        <Button onClick={handleReset} variant="secondary" className="flex-1" disabled={!imageLoaded}>
          Сбросить
        </Button>
        <Button onClick={handleCrop} className="flex-1" disabled={!imageLoaded}>
          Сохранить
        </Button>
      </div>
    </div>
  );
};

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

  const handleCropConfirm = async (croppedImageData?: string) => {
    if (!userId) return;

    try {
      let blob: Blob;

      if (croppedImageData) {
        // Use cropped image from AvatarCropper
        const response = await fetch(croppedImageData);
        blob = await response.blob();
      } else if (cropImage) {
        // Fallback: convert current cropImage to blob
        const response = await fetch(cropImage);
        blob = await response.blob();
      } else {
        return;
      }

      const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const fileName = `${userId}/avatar_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(fileName, croppedFile);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        toast.error('Ошибка загрузки аватара');
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('post-images')
        .getPublicUrl(fileName);

      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (error) {
        console.error('Update error:', error);
        toast.error('Ошибка обновления профиля');
        return;
      }

      setAvatarUrl(publicUrl);
      setCropImage(null);
      toast.success("Аватар обновлен");
    } catch (error) {
      toast.error("Ошибка обработки изображения");
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
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {currentUser && <NotificationBell userId={currentUser.id} />}
            {currentUser && <ChatIcon userId={currentUser.id} />}
            {currentUser ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                  {isModerator && (
                    <Link to="/moderation">
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm hover:bg-white/20 hover:text-white transition-colors">Модерация</Button>
                    </Link>
                  )}
                  <ProfileHoverCard userId={currentUser.id}>
                    <Button variant="ghost" size="sm" className="p-2 hover:bg-primary/10 hover:text-primary transition-colors">
                      <User className="h-4 w-4" />
                    </Button>
                  </ProfileHoverCard>
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
                className="p-1 h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
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
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Кадрирование аватара</DialogTitle>
                  </DialogHeader>
                  {cropImage && (
                    <AvatarCropper
                      imageSrc={cropImage}
                      onCropComplete={async (croppedImage) => {
                        setCropImage(null);
                        await handleCropConfirm(croppedImage);
                      }}
                      onCancel={() => setCropImage(null)}
                    />
                  )}
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
