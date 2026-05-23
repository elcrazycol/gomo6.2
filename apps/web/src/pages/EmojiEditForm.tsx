import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { FileUpload } from "@/components/FileUpload";
import { Settings, ArrowLeft, Plus, CheckCircle, Loader2 } from "lucide-react";
import { uploadFile, getPublicUrl, removeFile } from "@/utils/storage";

interface EmojiGroup {
  id: string;
  name: string;
}

interface Emoji {
  id: string;
  name: string;
  code: string;
  image_url: string;
  group_id: string;
}

const EmojiEditForm = () => {
  const { emojiId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");

  // Form state
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [emoji, setEmoji] = useState<Emoji | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [emojiName, setEmojiName] = useState("");
  const [emojiCode, setEmojiCode] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loading, setLoading] = useState(true);

  // New group dialog
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isMod = roles?.some(r => r.role === 'moderator' || r.role === 'admin');

    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);

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
  }, [navigate]);

  const loadEmoji = useCallback(async () => {
    if (!emojiId) return;

    try {
      const { data, error } = await supabase
        .from('emojis')
        .select('*')
        .eq('id', emojiId)
        .single();

      if (error) throw error;

      if (data) {
        setEmoji(data);
        setSelectedGroup(data.group_id);
        setEmojiName(data.name);
        setEmojiCode(data.code);
        setPreviewUrl(data.image_url);
      } else {
        toast.error("Эмодзи не найден");
        navigate("/moderation/emojis/edit");
      }
    } catch (error) {
      console.error('Error loading emoji:', error);
      toast.error('Ошибка загрузки эмодзи');
      navigate("/moderation/emojis/edit");
    } finally {
      setLoading(false);
    }
  }, [emojiId, navigate]);

  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('emoji_groups')
        .select('id, name')
        .order('name');

      if (error) throw error;

      setGroups(data || []);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isModerator && emojiId) {
      loadEmoji();
      loadGroups();
    }
  }, [isModerator, emojiId, loadEmoji, loadGroups]);

  const createGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error('Введите название группы');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('emoji_groups')
        .insert({ name: newGroupName.trim() })
        .select()
        .single();

      if (error) throw error;

      setGroups(prev => [...prev, data]);
      setSelectedGroup(data.id);
      setNewGroupName("");
      setShowNewGroupDialog(false);
      toast.success('Группа создана');
    } catch (error) {
      console.error('Error creating group:', error);
      toast.error('Ошибка создания группы');
    }
  };

  const compressImage = async (file: File, maxWidth: number = 250, maxHeight: number = 250): Promise<File> => {
    // For animated formats (GIF, WebP), don't compress to preserve animation
    if (file.type === 'image/gif' || file.type === 'image/webp') {
      // Check if resizing is needed
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          if (img.width <= maxWidth && img.height <= maxHeight) {
            // No resizing needed, return original
            resolve(file);
          } else {
            // For animated files that need resizing, we'll keep them as-is for now
            // since canvas compression would break animation
            resolve(file);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
      });
    }

    // For static images, compress normally
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        let { width, height } = img;

        // Calculate new dimensions
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: file.type, // Keep original MIME type
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            reject(new Error('Failed to compress image'));
          }
        }, file.type, 0.9); // Use original format with 90% quality
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const updateEmoji = async () => {
    if (!emoji || !selectedGroup || !emojiName.trim() || !emojiCode.trim()) {
      toast.error('Заполните все поля');
      return;
    }

    // Validate emoji code format (should be without colons)
    const cleanCode = emojiCode.replace(/^:+|:+$/g, '');
    if (!cleanCode) {
      toast.error('Введите код эмодзи');
      return;
    }

    setIsUpdating(true);

    try {
      let imageUrl = emoji.image_url;

      // Upload new image if selected
      if (selectedFile) {
        // Compress image
        const compressedFile = await compressImage(selectedFile);

        // Get file extension from original file
        const originalExtension = selectedFile.name.split('.').pop() || 'png';
        const fileName = `emoji_${Date.now()}_${cleanCode}.${originalExtension}`;
        await uploadFile('emojis', fileName, compressedFile);

        // Get public URL
        const { publicUrl } = getPublicUrl('emojis', fileName);

        imageUrl = publicUrl;

        // Delete old image — use proper S3-compatible removeFile
        if (emoji.image_url !== imageUrl) {
          const oldKey = emoji.image_url.split('/').pop();
          if (oldKey) {
            try {
              await removeFile('emojis', oldKey);
            } catch {
              // best-effort deletion, ignore errors
            }
          }
        }
      }

      // Check if code is unique (excluding current emoji)
      const { data: existingEmoji } = await supabase
        .from('emojis')
        .select('id')
        .eq('code', cleanCode)
        .neq('id', emoji.id)
        .maybeSingle();

      if (existingEmoji) {
        toast.error('Эмодзи с таким кодом уже существует');
        return;
      }

      // Update emoji in database
      const { error: updateError } = await supabase
        .from('emojis')
        .update({
          group_id: selectedGroup,
          name: emojiName.trim(),
          code: cleanCode,
          image_url: imageUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', emoji.id);

      if (updateError) throw updateError;

      toast.success('Эмодзи обновлен успешно!');
      navigate('/moderation/emojis/edit');

    } catch (error) {
      console.error('Error updating emoji:', error);
      toast.error('Ошибка обновления эмодзи');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
    if (previewUrl && previewUrl !== emoji?.image_url) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(emoji?.image_url || null);
  };

  if (!isModerator || loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Загрузка...</p>
            </>
          ) : (
            <p className="text-muted-foreground">Нет доступа</p>
          )}
        </div>
      </div>
    );
  }

  if (!emoji) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Эмодзи не найден</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link to="/moderation/emojis/edit">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Редактирование эмодзи</h1>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
              {user && (
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
              )}
            </div>
            {user && (
              <MobileMenu
                user={user}
                isModerator={true}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        <div className="space-y-6">
          {/* Группа */}
          <div className="space-y-2">
            <Label htmlFor="group">Группа</Label>
            <div className="flex gap-2">
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Выберите группу" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Dialog open={showNewGroupDialog} onOpenChange={setShowNewGroupDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Создать новую группу</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Input
                      placeholder="Название группы"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                    <Button onClick={createGroup} className="w-full">
                      Создать группу
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Название */}
          <div className="space-y-2">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name"
              placeholder="Название эмодзи"
              value={emojiName}
              onChange={(e) => setEmojiName(e.target.value)}
            />
          </div>

          {/* Код */}
          <div className="space-y-2">
            <Label htmlFor="code">Код эмодзи</Label>
            <div className="flex">
              <span className="inline-flex items-center px-3 bg-muted border border-r-0 border-border rounded-l-md text-sm">
                :
              </span>
              <Input
                id="code"
                placeholder="anime_hugs"
                value={emojiCode}
                onChange={(e) => setEmojiCode(e.target.value.replace(/^:+|:+$/g, ''))}
                className="rounded-l-none"
              />
              <span className="inline-flex items-center px-3 bg-muted border border-l-0 border-border rounded-r-md text-sm">
                :
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Код будет использоваться как :{emojiCode.replace(/^:+|:+$/g, '') || 'code'}:
            </p>
          </div>

          {/* Файл */}
          <div className="space-y-2">
            <Label>Изображение</Label>
            <FileUpload
              onFileSelect={handleFileSelect}
              currentFile={selectedFile}
              onRemove={handleFileRemove}
              maxSize={10}
            />
            {previewUrl && (
              <div className="flex justify-center">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-w-32 max-h-32 border border-border rounded"
                />
              </div>
            )}
          </div>

          {/* Предварительный просмотр */}
          {selectedGroup && emojiName && emojiCode && (
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Предварительный просмотр
              </h3>
              <div className="space-y-2 text-sm">
                <p><strong>Группа:</strong> {groups.find(g => g.id === selectedGroup)?.name}</p>
                <p><strong>Название:</strong> {emojiName}</p>
                <p><strong>Код:</strong> :{emojiCode.replace(/^:+|:+$/g, '')}:</p>
                <div className="flex items-center gap-2">
                  <strong>Изображение:</strong>
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Emoji preview"
                      className="w-8 h-8 border border-border rounded"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Кнопки */}
          <div className="flex gap-4">
            <Button
              onClick={updateEmoji}
              disabled={isUpdating || !selectedGroup || !emojiName.trim() || !emojiCode.trim()}
              className="flex-1"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Обновление...
                </>
              ) : (
                'Обновить эмодзи'
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => navigate('/moderation/emojis/edit')}
              className="flex-1"
            >
              Отмена
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EmojiEditForm;