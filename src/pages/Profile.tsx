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
  const [circleSizePercent, setCircleSizePercent] = useState(70); // percentage 10-100
  const [circlePosition, setCirclePosition] = useState({ x: 0, y: 0 }); // relative to container center - starts at center
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 320, height: 320 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate visible image bounds within container
  const getImageBounds = () => {
    const imgWidth = imageDimensions.width;
    const imgHeight = imageDimensions.height;
    const contWidth = containerSize.width;
    const contHeight = containerSize.height;

    if (!imgWidth || !imgHeight) return { left: 0, right: contWidth, top: 0, bottom: contHeight };

    const imgAspect = imgWidth / imgHeight;
    const containerAspect = contWidth / contHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (imgAspect > containerAspect) {
      // Image is wider than container (letterboxing on top/bottom)
      drawWidth = contWidth;
      drawHeight = contWidth / imgAspect;
      offsetX = 0;
      offsetY = (contHeight - drawHeight) / 2;
    } else {
      // Image is taller than container (letterboxing on sides)
      drawHeight = contHeight;
      drawWidth = contHeight * imgAspect;
      offsetX = (contWidth - drawWidth) / 2;
      offsetY = 0;
    }

    return {
      left: offsetX,
      right: offsetX + drawWidth,
      top: offsetY,
      bottom: offsetY + drawHeight,
      drawWidth,
      drawHeight
    };
  };

  // Get maximum possible circle size that fits within image bounds
  const getMaxCircleSize = () => {
    const bounds = getImageBounds();
    const imageWidth = bounds.drawWidth;
    const imageHeight = bounds.drawHeight;

    // Circle diameter can't be larger than the smaller dimension of the visible image
    return Math.min(imageWidth, imageHeight);
  };

  // Convert percentage to actual pixel size
  const getCircleSizePixels = () => {
    const maxSize = getMaxCircleSize();
    return Math.max(20, (circleSizePercent / 100) * maxSize); // minimum 20px
  };

  const constrainCirclePosition = (absoluteX: number, absoluteY: number) => {
    const container = containerRef.current;
    if (!container) return { x: absoluteX, y: absoluteY };

    const rect = container.getBoundingClientRect();
    const bounds = getImageBounds();
    const circleRadius = getCircleSizePixels() / 2;

    // Convert image bounds to absolute screen coordinates
    const absBounds = {
      left: rect.left + bounds.left,
      right: rect.left + bounds.right,
      top: rect.top + bounds.top,
      bottom: rect.top + bounds.bottom
    };

    // Constrain circle center to stay within image bounds (allow circle to touch edges)
    const margin = 2; // Small margin to prevent visual clipping
    const constrainedX = Math.max(absBounds.left + circleRadius - margin, Math.min(absBounds.right - circleRadius + margin, absoluteX));
    const constrainedY = Math.max(absBounds.top + circleRadius - margin, Math.min(absBounds.bottom - circleRadius + margin, absoluteY));

    return { x: constrainedX, y: constrainedY };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      const touch = e.touches[0];
      setDragStart({
        x: touch.clientX,
        y: touch.clientY
      });
    }
  };

  const updateCirclePosition = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerCenterX = rect.left + rect.width / 2;
    const containerCenterY = rect.top + rect.height / 2;

    // Set desired circle center position to mouse/finger position
    const desiredCenterX = clientX;
    const desiredCenterY = clientY;

    // Constrain to image bounds
    const constrained = constrainCirclePosition(desiredCenterX, desiredCenterY);

    // Convert back to relative position from container center
    setCirclePosition({
      x: constrained.x - containerCenterX,
      y: constrained.y - containerCenterY
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    updateCirclePosition(e.clientX, e.clientY);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    updateCirclePosition(touch.clientX, touch.clientY);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Load image dimensions and container size
  useEffect(() => {
    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height });
      setImageLoaded(true);
    };
    img.src = imageSrc;

    // Update container size
    const updateContainerSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateContainerSize();
    window.addEventListener('resize', updateContainerSize);
    return () => window.removeEventListener('resize', updateContainerSize);
  }, [imageSrc]);

  // Center the circle when image is fully loaded and dimensions are available
  useEffect(() => {
    if (imageLoaded && imageDimensions.width && imageDimensions.height && containerSize.width) {
      // Small delay to ensure DOM is fully updated
      const timeoutId = setTimeout(() => {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const bounds = getImageBounds();

          // Center on the visible image area
          const imageCenterX = rect.left + bounds.left + bounds.drawWidth / 2;
          const imageCenterY = rect.top + bounds.top + bounds.drawHeight / 2;

          const containerCenterX = rect.left + rect.width / 2;
          const containerCenterY = rect.top + rect.height / 2;

          // Ensure the position is within bounds
          const circleRadius = getCircleSizePixels() / 2;
          const boundsAbs = {
            left: rect.left + bounds.left,
            right: rect.left + bounds.right,
            top: rect.top + bounds.top,
            bottom: rect.top + bounds.bottom
          };

          const constrainedX = Math.max(boundsAbs.left + circleRadius, Math.min(boundsAbs.right - circleRadius, imageCenterX));
          const constrainedY = Math.max(boundsAbs.top + circleRadius, Math.min(boundsAbs.bottom - circleRadius, imageCenterY));

          setCirclePosition({
            x: constrainedX - containerCenterX,
            y: constrainedY - containerCenterY
          });
        }
      }, 100); // Small delay for DOM updates

      return () => clearTimeout(timeoutId);
    }
  }, [imageLoaded, imageDimensions, containerSize, circleSizePercent]);

  // Update circle position when size changes to keep it within bounds
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerCenterX = rect.left + rect.width / 2;
    const containerCenterY = rect.top + rect.height / 2;

    const currentCenterX = containerCenterX + circlePosition.x;
    const currentCenterY = containerCenterY + circlePosition.y;

    const constrained = constrainCirclePosition(currentCenterX, currentCenterY);

    if (constrained.x !== currentCenterX || constrained.y !== currentCenterY) {
      setCirclePosition({
        x: constrained.x - containerCenterX,
        y: constrained.y - containerCenterY
      });
    }
  }, [circleSizePercent, imageDimensions]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchend', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging]);

  const handleCrop = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = 200;
      canvas.height = 200;

      // Create circular crop
      ctx.save();
      ctx.beginPath();
      ctx.arc(100, 100, 100, 0, 2 * Math.PI);
      ctx.clip();

      // Calculate crop coordinates
      // The image is displayed with object-contain, so we need to calculate
      // where the circle intersects with the actual image
      const containerWidth = 320;
      const containerHeight = 320;

      // Calculate how the image fits in the container
      const imgAspect = img.width / img.height;
      const containerAspect = containerWidth / containerHeight;

      let drawWidth, drawHeight, offsetX, offsetY;

      if (imgAspect > containerAspect) {
        // Image is wider than container
        drawWidth = containerWidth;
        drawHeight = containerWidth / imgAspect;
        offsetX = 0;
        offsetY = (containerHeight - drawHeight) / 2;
      } else {
        // Image is taller than container
        drawHeight = containerHeight;
        drawWidth = containerHeight * imgAspect;
        offsetX = (containerWidth - drawWidth) / 2;
        offsetY = 0;
      }

      // Circle center relative to container
      const circleCenterX = containerWidth / 2 + circlePosition.x;
      const circleCenterY = containerHeight / 2 + circlePosition.y;
      const circleRadius = getCircleSizePixels() / 2;

      // Check if circle intersects with actual image bounds
      const imageLeft = offsetX;
      const imageRight = offsetX + drawWidth;
      const imageTop = offsetY;
      const imageBottom = offsetY + drawHeight;

      // Constrain circle to image bounds
      const constrainedCenterX = Math.max(imageLeft + circleRadius, Math.min(imageRight - circleRadius, circleCenterX));
      const constrainedCenterY = Math.max(imageTop + circleRadius, Math.min(imageBottom - circleRadius, circleCenterY));

      // Convert to image coordinates
      const imageX = ((constrainedCenterX - offsetX) / drawWidth) * img.width;
      const imageY = ((constrainedCenterY - offsetY) / drawHeight) * img.height;
      const cropRadius = (circleRadius / Math.min(drawWidth / img.width, drawHeight / img.height));

      // Draw the cropped circular area
      ctx.drawImage(
        img,
        imageX - cropRadius,
        imageY - cropRadius,
        cropRadius * 2,
        cropRadius * 2,
        0,
        0,
        200,
        200
      );

      ctx.restore();

      const croppedImage = canvas.toDataURL('image/png');
      onCropComplete(croppedImage);
    };

    img.src = imageSrc;
  };

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="relative w-full h-80 bg-muted rounded-lg overflow-hidden touch-none"
      >
        <img
          src={imageSrc}
          alt="Crop preview"
          className="w-full h-full object-contain"
        />

        {/* Crop circle - constrained to image bounds */}
        <div
          className="absolute border-2 border-white border-dashed rounded-full cursor-move shadow-lg select-none"
          style={{
            width: `${getCircleSizePixels()}px`,
            height: `${getCircleSizePixels()}px`,
            left: `calc(50% + ${circlePosition.x}px - ${getCircleSizePixels() / 2}px)`,
            top: `calc(50% + ${circlePosition.y}px - ${getCircleSizePixels() / 2}px)`,
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.8)',
            touchAction: 'none',
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Размер круга</label>
        <input
          type="range"
          min="10"
          max="100"
          step="5"
          value={circleSizePercent}
          onChange={(e) => setCircleSizePercent(Number(e.target.value))}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer touch-manipulation"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${((circleSizePercent - 10) / 90) * 100}%, hsl(var(--muted)) ${((circleSizePercent - 10) / 90) * 100}%, hsl(var(--muted)) 100%)`
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Маленький</span>
          <span>Размер: {circleSizePercent}% ({Math.round(getCircleSizePixels())}px)</span>
          <span>Большой</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={onCancel} variant="outline" className="flex-1">
          Отмена
        </Button>
        <Button onClick={handleCrop} className="flex-1">
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
              <Button variant="ghost" size="sm" className="p-2">
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
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                    </Link>
                  )}
                  <ProfileHoverCard userId={currentUser.id}>
                    <Button variant="ghost" size="sm" className="p-2">
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
