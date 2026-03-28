import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PentagramLoader } from "@/components/PentagramLoader";
import { HeaderUsername } from "@/components/HeaderUsername";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { User, X, Copy, Trash2, Plus } from "lucide-react";
import { parseCssToStyle, clearCustomizationCache } from "@/utils/profileCustomization";

interface TextShadow {
  id: string;
  x: number;
  y: number;
  blur: number;
  color: string;
}

interface ProfileCustomization {
  username_css: string | null;
  username_icon_svg: string | null;
  username_icon_fill: string | null;
  username_icon_stroke: string | null;
  profile_badge_text: string | null;
  profile_badge_css: string | null;
}

const CustomProfile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");

  // Username customization
  const [usernameColor, setUsernameColor] = useState("#d6d6de");
  const [usernameGradient, setUsernameGradient] = useState("");
  const [usernameGradientType, setUsernameGradientType] = useState<"solid" | "gradient">("solid");
  const [usernameGradientStart, setUsernameGradientStart] = useState("#ff0000");
  const [usernameGradientEnd, setUsernameGradientEnd] = useState("#0000ff");
  const [usernameGradientDirection, setUsernameGradientDirection] = useState(90);
  const [usernameTextShadows, setUsernameTextShadows] = useState<TextShadow[]>([]);
  const [usernameBorderRadius, setUsernameBorderRadius] = useState(0);
  const [usernameBackgroundColor, setUsernameBackgroundColor] = useState("");
  const [usernameBackgroundImage, setUsernameBackgroundImage] = useState("");
  const [usernameBackgroundClip, setUsernameBackgroundClip] = useState(false);
  const [usernameCustomCss, setUsernameCustomCss] = useState("");
  const [isUpdatingFromCss, setIsUpdatingFromCss] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Icon customization
  const [iconSvg, setIconSvg] = useState("");
  const [iconFill, setIconFill] = useState("#ffffff");
  const [iconStroke, setIconStroke] = useState("#000000");

  // Badge customization
  const [badgeText, setBadgeText] = useState("");
  const [badgeColor, setBadgeColor] = useState("#ffffff");
  const [badgeGradient, setBadgeGradient] = useState("");
  const [badgeGradientType, setBadgeGradientType] = useState<"solid" | "gradient">("solid");
  const [badgeGradientStart, setBadgeGradientStart] = useState("#ff0000");
  const [badgeGradientEnd, setBadgeGradientEnd] = useState("#0000ff");
  const [badgeGradientDirection, setBadgeGradientDirection] = useState(90);
  const [badgeTextShadows, setBadgeTextShadows] = useState<TextShadow[]>([]);
  const [badgeBoxShadows, setBadgeBoxShadows] = useState<TextShadow[]>([]);
  const [badgeCustomCss, setBadgeCustomCss] = useState("");

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Load current user profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, avatar_url")
          .eq("id", user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
          setAvatarUrl(profile.avatar_url);
        }


        // Load customization
        await loadCustomization(user.id);
      }
      
      setLoading(false);
    };

    getUser();
  }, []);

  const loadCustomization = async (userId: string) => {
    const { data, error } = await supabase
      .from("profile_customization")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error("Error loading customization:", error);
      return;
    }

    if (data) {
      // Parse username CSS
      if (data.username_css) {
        parseUsernameCss(data.username_css);
        setUsernameCustomCss(data.username_css);
      }

      // Load icon
      if (data.username_icon_svg) setIconSvg(data.username_icon_svg);
      if (data.username_icon_fill) setIconFill(data.username_icon_fill);
      if (data.username_icon_stroke) setIconStroke(data.username_icon_stroke);

      // Parse badge CSS
      if (data.profile_badge_text) setBadgeText(data.profile_badge_text);
      if (data.profile_badge_css) {
        parseBadgeCss(data.profile_badge_css);
        setBadgeCustomCss(data.profile_badge_css);
      }
    }
  };

  const parseUsernameCss = (css: string) => {
    // Simple CSS parser - extract values
    const colorMatch = css.match(/color:\s*([^;]+)/);
    if (colorMatch) {
      const color = colorMatch[1].trim();
      if (color.startsWith('#')) {
        setUsernameColor(color);
        setUsernameGradientType("solid");
      } else if (color.includes('gradient')) {
        setUsernameGradientType("gradient");
        // Parse gradient
        const gradientMatch = css.match(/background:\s*([^;]+)/);
        if (gradientMatch) {
          setUsernameGradient(gradientMatch[1].trim());
        }
      }
    }

    const borderRadiusMatch = css.match(/border-radius:\s*([^;]+)/);
    if (borderRadiusMatch) {
      const radius = parseInt(borderRadiusMatch[1].trim());
      if (!isNaN(radius)) setUsernameBorderRadius(radius);
    }

    const bgColorMatch = css.match(/background-color:\s*([^;]+)/);
    if (bgColorMatch) {
      setUsernameBackgroundColor(bgColorMatch[1].trim());
    }

    const bgImageMatch = css.match(/background-image:\s*([^;]+)/);
    if (bgImageMatch) {
      setUsernameBackgroundImage(bgImageMatch[1].trim());
    }

    const clipMatch = css.match(/-webkit-background-clip:\s*([^;]+)/);
    if (clipMatch && clipMatch[1].trim() === 'text') {
      setUsernameBackgroundClip(true);
    }

    // Parse text shadows
    const shadowMatch = css.match(/text-shadow:\s*([^;]+)/);
    if (shadowMatch) {
      const shadows = parseTextShadows(shadowMatch[1].trim());
      setUsernameTextShadows(shadows);
    }
  };

  const parseBadgeCss = (css: string) => {
    const colorMatch = css.match(/color:\s*([^;]+)/);
    if (colorMatch) {
      const color = colorMatch[1].trim();
      if (color.startsWith('#')) {
        setBadgeColor(color);
        setBadgeGradientType("solid");
      }
    }

    const shadowMatch = css.match(/text-shadow:\s*([^;]+)/);
    if (shadowMatch) {
      const shadows = parseTextShadows(shadowMatch[1].trim());
      setBadgeTextShadows(shadows);
    }

    const boxShadowMatch = css.match(/box-shadow:\s*([^;]+)/);
    if (boxShadowMatch) {
      const shadows = parseTextShadows(boxShadowMatch[1].trim());
      setBadgeBoxShadows(shadows);
    }
  };

  const parseTextShadows = (shadowStr: string): TextShadow[] => {
    // Parse multiple shadows like "0px -1px 1px #fff,0px -2px 1px #c000ff"
    const shadows: TextShadow[] = [];
    const shadowParts = shadowStr.split(',').map(s => s.trim());
    
    shadowParts.forEach((part, index) => {
      const values = part.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)/);
      if (values) {
        shadows.push({
          id: `shadow-${index}`,
          x: parseFloat(values[1]),
          y: parseFloat(values[2]),
          blur: parseFloat(values[3]),
          color: values[4].trim()
        });
      }
    });

    return shadows;
  };

  const generateUsernameCssFromConstructor = (): string => {

    const styles: string[] = [];

    // Color or gradient
    if (usernameGradientType === "gradient" && usernameGradient) {
      styles.push(`background: ${usernameGradient}`);
      if (usernameBackgroundClip) {
        styles.push(`-webkit-background-clip: text`);
        styles.push(`-webkit-text-fill-color: transparent`);
      } else {
        // If gradient but no clip, still set color as fallback
        styles.push(`color: ${usernameColor}`);
      }
    } else {
      styles.push(`color: ${usernameColor}`);
    }

    // Background color (only if not using gradient with clip)
    if (usernameBackgroundColor && !(usernameGradientType === "gradient" && usernameBackgroundClip)) {
      styles.push(`background-color: ${usernameBackgroundColor}`);
    }

    // Background image
    if (usernameBackgroundImage) {
      styles.push(`background-image: ${usernameBackgroundImage}`);
    }

    // Border radius
    if (usernameBorderRadius > 0) {
      styles.push(`border-radius: ${usernameBorderRadius}px`);
    }

    // Text shadows (max 5px blur)
    if (usernameTextShadows.length > 0) {
      const shadowStr = usernameTextShadows
        .map(shadow => {
          const blur = Math.min(shadow.blur, 5);
          return `${shadow.x}px ${shadow.y}px ${blur}px ${shadow.color}`;
        })
        .join(',');
      styles.push(`text-shadow: ${shadowStr}`);
    }

    return styles.join(';');
  };

  const generateBadgeCss = (): string => {
    return badgeCustomCss || generateBadgeCssFromConstructor();
  };

  const generateBadgeCssFromConstructor = (): string => {
    const styles: string[] = [];

    // Background (gradient or solid)
    if (badgeGradientType === "gradient" && badgeGradient) {
      styles.push(`background: ${badgeGradient}`);
    } else if (badgeGradientType === "solid") {
      // For solid, we can set background-color if needed
      // But for now, just set text color
    }

    // Text color
    styles.push(`color: ${badgeColor}`);

    // Text shadows
    if (badgeTextShadows.length > 0) {
      const shadowStr = badgeTextShadows
        .map(shadow => `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`)
        .join(',');
      styles.push(`text-shadow: ${shadowStr}`);
    }

    // Box shadows
    if (badgeBoxShadows.length > 0) {
      const shadowStr = badgeBoxShadows
        .map(shadow => `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`)
        .join(',');
      styles.push(`box-shadow: ${shadowStr}`);
    }

    return styles.join(';');
  };

  const addTextShadow = (type: "username" | "badge") => {
    const newShadow: TextShadow = {
      id: `shadow-${Date.now()}`,
      x: 0,
      y: -1,
      blur: 1,
      color: "#ffffff"
    };

    if (type === "username") {
      setUsernameTextShadows([...usernameTextShadows, newShadow]);
    } else {
      setBadgeTextShadows([...badgeTextShadows, newShadow]);
    }
  };

  const addBoxShadow = () => {
    const newShadow: TextShadow = {
      id: `box-shadow-${Date.now()}`,
      x: 0,
      y: 1,
      blur: 2,
      color: "#000000"
    };
    setBadgeBoxShadows([...badgeBoxShadows, newShadow]);
  };

  const removeShadow = (id: string, type: "username" | "badge" | "badge-box") => {
    if (type === "username") {
      setUsernameTextShadows(usernameTextShadows.filter(s => s.id !== id));
    } else if (type === "badge") {
      setBadgeTextShadows(badgeTextShadows.filter(s => s.id !== id));
    } else {
      setBadgeBoxShadows(badgeBoxShadows.filter(s => s.id !== id));
    }
  };

  const duplicateShadow = (id: string, type: "username" | "badge" | "badge-box") => {
    let shadows: TextShadow[] = [];
    if (type === "username") {
      shadows = usernameTextShadows;
    } else if (type === "badge") {
      shadows = badgeTextShadows;
    } else {
      shadows = badgeBoxShadows;
    }

    const shadow = shadows.find(s => s.id === id);
    if (shadow) {
      const newShadow = { ...shadow, id: `${shadow.id}-copy-${Date.now()}` };
      if (type === "username") {
        setUsernameTextShadows([...usernameTextShadows, newShadow]);
      } else if (type === "badge") {
        setBadgeTextShadows([...badgeTextShadows, newShadow]);
      } else {
        setBadgeBoxShadows([...badgeBoxShadows, newShadow]);
      }
    }
  };

  const updateShadow = (id: string, field: keyof TextShadow, value: any, type: "username" | "badge" | "badge-box") => {
    if (type === "username") {
      setUsernameTextShadows(usernameTextShadows.map(s => 
        s.id === id ? { ...s, [field]: value } : s
      ));
    } else if (type === "badge") {
      setBadgeTextShadows(badgeTextShadows.map(s => 
        s.id === id ? { ...s, [field]: value } : s
      ));
    } else {
      setBadgeBoxShadows(badgeBoxShadows.map(s => 
        s.id === id ? { ...s, [field]: value } : s
      ));
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const usernameCss = usernameCustomCss || generateUsernameCssFromConstructor();
      const badgeCss = badgeCustomCss || generateBadgeCssFromConstructor();

      const { error } = await supabase
        .from("profile_customization")
        .upsert({
          user_id: user.id,
          username_css: usernameCss || null,
          username_icon_svg: iconSvg || null,
          username_icon_fill: iconFill || null,
          username_icon_stroke: iconStroke || null,
          profile_badge_text: badgeText || null,
          profile_badge_css: badgeCss || null,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      // Clear cache to force reload
      clearCustomizationCache(user.id);

      toast.success("Кастомизация сохранена!");
    } catch (error: any) {
      console.error("Error saving customization:", error);
      toast.error("Ошибка сохранения: " + error.message);
    } finally {
      setSaving(false);
    }
  };

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

  const previewUsernameCss = usernameCustomCss || generateUsernameCssFromConstructor();
  const previewBadgeCss = badgeCustomCss || generateBadgeCssFromConstructor();

  return (
    <main className="max-w-6xl mx-auto p-4">
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Кастомизация профиля</h1>
              <p className="text-muted-foreground">Настройте внешний вид вашего профиля</p>
            </div>

            {/* Preview */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Предпросмотр профиля</h2>
              <div className="bg-post-header border border-border p-4 rounded-lg">
                <div className="flex items-center gap-4">
                  {/* Real Avatar */}
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
                  </div>
                  
                  {/* User Info - matching Profile.tsx layout */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        {iconSvg && (
                          <span
                            className="inline-flex items-center justify-center"
                            dangerouslySetInnerHTML={{ __html: iconSvg }}
                            style={{
                              fill: iconFill,
                              stroke: iconStroke,
                              width: '1em',
                              height: '1em',
                            }}
                          />
                        )}
                        <span 
                          className="text-2xl font-bold"
                          style={parseCssToStyle(previewUsernameCss)}
                        >
                          {currentUserUsername || "Ваш никнейм"}
                        </span>
                        {badgeText && (
                          <span 
                            className="px-2 py-1 rounded text-xs font-medium ml-2"
                            style={parseCssToStyle(previewBadgeCss)}
                          >
                            {badgeText}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      ID: {user?.id.slice(0, 8)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Tabs defaultValue="username" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="username">Никнейм</TabsTrigger>
                <TabsTrigger value="icon">Иконка</TabsTrigger>
                <TabsTrigger value="badge">Пад профиля</TabsTrigger>
              </TabsList>

              {/* Username Tab */}
              <TabsContent value="username" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Кастомизация никнейма</h3>
                  
                  <div className="space-y-6">
                    {/* Custom CSS Input */}
                    <div>
                      <Label>Прямой ввод CSS (опционально)</Label>
                      <Textarea
                        value={usernameCustomCss}
                        onChange={(e) => handleUsernameCssChange(e.target.value)}
                        placeholder="color: #d6d6de;text-shadow:0px -1px 1px #fff..."
                        rows={3}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Или используйте конструктор ниже
                      </p>
                    </div>

                    <Separator />

                    {/* Color Type */}
                    <div>
                      <Label>Тип заливки</Label>
                      <div className="flex gap-4 mt-2">
                        <Button
                          variant={usernameGradientType === "solid" ? "default" : "outline"}
                          onClick={() => setUsernameGradientType("solid")}
                          size="sm"
                        >
                          Заливка
                        </Button>
                        <Button
                          variant={usernameGradientType === "gradient" ? "default" : "outline"}
                          onClick={() => setUsernameGradientType("gradient")}
                          size="sm"
                        >
                          Градиент
                        </Button>
                      </div>
                    </div>

                    {/* Solid Color */}
                    {usernameGradientType === "solid" && (
                      <div>
                        <Label>Цвет текста</Label>
                        <div className="flex gap-2 mt-2">
                          <Input
                            type="color"
                            value={usernameColor}
                            onChange={(e) => setUsernameColor(e.target.value)}
                            className="w-20 h-10"
                          />
                          <Input
                            type="text"
                            value={usernameColor}
                            onChange={(e) => setUsernameColor(e.target.value)}
                            placeholder="#d6d6de"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    )}

                    {/* Gradient */}
                    {usernameGradientType === "gradient" && (
                      <div className="space-y-4">
                        <div>
                          <Label>Начальный цвет</Label>
                          <div className="flex gap-2 mt-2">
                            <Input
                              type="color"
                              value={usernameGradientStart}
                              onChange={(e) => setUsernameGradientStart(e.target.value)}
                              className="w-20 h-10"
                            />
                            <Input
                              type="text"
                              value={usernameGradientStart}
                              onChange={(e) => setUsernameGradientStart(e.target.value)}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Конечный цвет</Label>
                          <div className="flex gap-2 mt-2">
                            <Input
                              type="color"
                              value={usernameGradientEnd}
                              onChange={(e) => setUsernameGradientEnd(e.target.value)}
                              className="w-20 h-10"
                            />
                            <Input
                              type="text"
                              value={usernameGradientEnd}
                              onChange={(e) => setUsernameGradientEnd(e.target.value)}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Направление градиента: {usernameGradientDirection}°</Label>
                          <Slider
                            value={[usernameGradientDirection]}
                            onValueChange={(vals) => setUsernameGradientDirection(vals[0])}
                            min={0}
                            max={360}
                            step={1}
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label>
                            <input
                              type="checkbox"
                              checked={usernameBackgroundClip}
                              onChange={(e) => setUsernameBackgroundClip(e.target.checked)}
                              className="mr-2"
                            />
                            Применить градиент к тексту (background-clip: text)
                          </Label>
                        </div>
                        <Button
                          onClick={() => {
                            const gradient = `linear-gradient(${usernameGradientDirection}deg, ${usernameGradientStart}, ${usernameGradientEnd})`;
                            setUsernameGradient(gradient);
                          }}
                          size="sm"
                        >
                          Применить градиент
                        </Button>
                      </div>
                    )}

                    {/* Border Radius */}
                    <div>
                      <Label>Скругление углов: {usernameBorderRadius}px</Label>
                      <Slider
                        value={[usernameBorderRadius]}
                        onValueChange={(vals) => setUsernameBorderRadius(vals[0])}
                        min={0}
                        max={20}
                        step={1}
                        className="mt-2"
                      />
                    </div>

                    {/* Background Color */}
                    <div>
                      <Label>Цвет фона</Label>
                      <Input
                        type="text"
                        value={usernameBackgroundColor}
                        onChange={(e) => setUsernameBackgroundColor(e.target.value)}
                        placeholder="rgba(255, 0, 0, 0.5) или #ff0000"
                        className="mt-2"
                      />
                    </div>

                    {/* Background Image */}
                    <div>
                      <Label>Фоновое изображение</Label>
                      <Input
                        type="text"
                        value={usernameBackgroundImage}
                        onChange={(e) => setUsernameBackgroundImage(e.target.value)}
                        placeholder="url('...') или linear-gradient(...)"
                        className="mt-2"
                      />
                    </div>

                    {/* Text Shadows */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Тени текста</Label>
                        <Button
                          onClick={() => addTextShadow("username")}
                          size="sm"
                          variant="outline"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Добавить тень
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {usernameTextShadows.map((shadow) => (
                          <Card key={shadow.id} className="p-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs">X: {shadow.x}px</Label>
                                <Slider
                                  value={[shadow.x]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "x", vals[0], "username")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Y: {shadow.y}px</Label>
                                <Slider
                                  value={[shadow.y]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "y", vals[0], "username")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Blur: {shadow.blur}px (макс 5px)</Label>
                                <Slider
                                  value={[shadow.blur]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "blur", Math.min(vals[0], 5), "username")}
                                  min={0}
                                  max={5}
                                  step={0.1}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Цвет</Label>
                                <div className="flex gap-2 mt-1">
                                  <Input
                                    type="color"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "username")}
                                    className="w-12 h-8"
                                  />
                                  <Input
                                    type="text"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "username")}
                                    className="flex-1 text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <Button
                                onClick={() => duplicateShadow(shadow.id, "username")}
                                size="sm"
                                variant="outline"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <Button
                                onClick={() => removeShadow(shadow.id, "username")}
                                size="sm"
                                variant="destructive"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </TabsContent>

              {/* Icon Tab */}
              <TabsContent value="icon" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Иконка возле никнейма</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <Label>SVG код иконки</Label>
                      <Textarea
                        value={iconSvg}
                        onChange={(e) => setIconSvg(e.target.value)}
                        placeholder='<svg width="16" height="16" viewBox="0 0 16 16">...</svg>'
                        rows={5}
                        className="font-mono text-sm mt-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Вставьте SVG код иконки, которая будет отображаться справа от никнейма
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Цвет заливки</Label>
                        <div className="flex gap-2 mt-2">
                          <Input
                            type="color"
                            value={iconFill}
                            onChange={(e) => setIconFill(e.target.value)}
                            className="w-20 h-10"
                          />
                          <Input
                            type="text"
                            value={iconFill}
                            onChange={(e) => setIconFill(e.target.value)}
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Цвет обводки</Label>
                        <div className="flex gap-2 mt-2">
                          <Input
                            type="color"
                            value={iconStroke}
                            onChange={(e) => setIconStroke(e.target.value)}
                            className="w-20 h-10"
                          />
                          <Input
                            type="text"
                            value={iconStroke}
                            onChange={(e) => setIconStroke(e.target.value)}
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>

                    {iconSvg && (
                      <div className="p-4 bg-muted rounded-lg">
                        <Label>Предпросмотр:</Label>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="font-bold">Никнейм</span>
                          <div 
                            className="w-5 h-5 flex items-center justify-center"
                            dangerouslySetInnerHTML={{ __html: iconSvg }}
                            style={{ fill: iconFill, stroke: iconStroke }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </TabsContent>

              {/* Badge Tab */}
              <TabsContent value="badge" className="space-y-4">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Пад профиля</h3>
                  
                  <div className="space-y-6">
                    <div>
                      <Label>Текст пада</Label>
                      <Input
                        value={badgeText}
                        onChange={(e) => setBadgeText(e.target.value)}
                        placeholder="VIP, Модератор, и т.д."
                        className="mt-2"
                      />
                    </div>

                    <Separator />

                    {/* Custom CSS Input */}
                    <div>
                      <Label>Прямой ввод CSS (опционально)</Label>
                      <Textarea
                        value={badgeCustomCss}
                        onChange={(e) => handleBadgeCssChange(e.target.value)}
                        placeholder="color: #fff; background: linear-gradient(...);"
                        rows={3}
                        className="font-mono text-sm"
                      />
                    </div>

                    {/* Color Type */}
                    <div>
                      <Label>Тип заливки</Label>
                      <div className="flex gap-4 mt-2">
                        <Button
                          variant={badgeGradientType === "solid" ? "default" : "outline"}
                          onClick={() => setBadgeGradientType("solid")}
                          size="sm"
                        >
                          Заливка
                        </Button>
                        <Button
                          variant={badgeGradientType === "gradient" ? "default" : "outline"}
                          onClick={() => setBadgeGradientType("gradient")}
                          size="sm"
                        >
                          Градиент
                        </Button>
                      </div>
                    </div>

                    {/* Solid Color */}
                    {badgeGradientType === "solid" && (
                      <div>
                        <Label>Цвет текста</Label>
                        <div className="flex gap-2 mt-2">
                          <Input
                            type="color"
                            value={badgeColor}
                            onChange={(e) => setBadgeColor(e.target.value)}
                            className="w-20 h-10"
                          />
                          <Input
                            type="text"
                            value={badgeColor}
                            onChange={(e) => setBadgeColor(e.target.value)}
                            className="flex-1"
                          />
                        </div>
                      </div>
                    )}

                    {/* Gradient */}
                    {badgeGradientType === "gradient" && (
                      <div className="space-y-4">
                        <div>
                          <Label>Начальный цвет</Label>
                          <div className="flex gap-2 mt-2">
                            <Input
                              type="color"
                              value={badgeGradientStart}
                              onChange={(e) => setBadgeGradientStart(e.target.value)}
                              className="w-20 h-10"
                            />
                            <Input
                              type="text"
                              value={badgeGradientStart}
                              onChange={(e) => setBadgeGradientStart(e.target.value)}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Конечный цвет</Label>
                          <div className="flex gap-2 mt-2">
                            <Input
                              type="color"
                              value={badgeGradientEnd}
                              onChange={(e) => setBadgeGradientEnd(e.target.value)}
                              className="w-20 h-10"
                            />
                            <Input
                              type="text"
                              value={badgeGradientEnd}
                              onChange={(e) => setBadgeGradientEnd(e.target.value)}
                              className="flex-1"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>Направление градиента: {badgeGradientDirection}°</Label>
                          <Slider
                            value={[badgeGradientDirection]}
                            onValueChange={(vals) => setBadgeGradientDirection(vals[0])}
                            min={0}
                            max={360}
                            step={1}
                            className="mt-2"
                          />
                        </div>
                        <Button
                          onClick={() => {
                            const gradient = `linear-gradient(${badgeGradientDirection}deg, ${badgeGradientStart}, ${badgeGradientEnd})`;
                            setBadgeGradient(gradient);
                          }}
                          size="sm"
                        >
                          Применить градиент
                        </Button>
                      </div>
                    )}

                    {/* Text Shadows */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Тени текста</Label>
                        <Button
                          onClick={() => addTextShadow("badge")}
                          size="sm"
                          variant="outline"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Добавить тень
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {badgeTextShadows.map((shadow) => (
                          <Card key={shadow.id} className="p-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs">X: {shadow.x}px</Label>
                                <Slider
                                  value={[shadow.x]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "x", vals[0], "badge")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Y: {shadow.y}px</Label>
                                <Slider
                                  value={[shadow.y]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "y", vals[0], "badge")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Blur: {shadow.blur}px</Label>
                                <Slider
                                  value={[shadow.blur]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "blur", vals[0], "badge")}
                                  min={0}
                                  max={10}
                                  step={0.1}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Цвет</Label>
                                <div className="flex gap-2 mt-1">
                                  <Input
                                    type="color"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "badge")}
                                    className="w-12 h-8"
                                  />
                                  <Input
                                    type="text"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "badge")}
                                    className="flex-1 text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <Button
                                onClick={() => duplicateShadow(shadow.id, "badge")}
                                size="sm"
                                variant="outline"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <Button
                                onClick={() => removeShadow(shadow.id, "badge")}
                                size="sm"
                                variant="destructive"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>

                    {/* Box Shadows */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Тени блока</Label>
                        <Button
                          onClick={addBoxShadow}
                          size="sm"
                          variant="outline"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Добавить тень
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {badgeBoxShadows.map((shadow) => (
                          <Card key={shadow.id} className="p-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs">X: {shadow.x}px</Label>
                                <Slider
                                  value={[shadow.x]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "x", vals[0], "badge-box")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Y: {shadow.y}px</Label>
                                <Slider
                                  value={[shadow.y]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "y", vals[0], "badge-box")}
                                  min={-10}
                                  max={10}
                                  step={0.5}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Blur: {shadow.blur}px</Label>
                                <Slider
                                  value={[shadow.blur]}
                                  onValueChange={(vals) => updateShadow(shadow.id, "blur", vals[0], "badge-box")}
                                  min={0}
                                  max={10}
                                  step={0.1}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Цвет</Label>
                                <div className="flex gap-2 mt-1">
                                  <Input
                                    type="color"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "badge-box")}
                                    className="w-12 h-8"
                                  />
                                  <Input
                                    type="text"
                                    value={shadow.color}
                                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value, "badge-box")}
                                    className="flex-1 text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                              <Button
                                onClick={() => duplicateShadow(shadow.id, "badge-box")}
                                size="sm"
                                variant="outline"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <Button
                                onClick={() => removeShadow(shadow.id, "badge-box")}
                                size="sm"
                                variant="destructive"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} size="lg">
                {saving ? "Сохранение..." : "Сохранить кастомизацию"}
              </Button>
            </div>
          </div>
        </main>
  );
};

export default CustomProfile;
