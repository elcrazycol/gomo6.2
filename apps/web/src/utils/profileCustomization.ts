import { supabase } from "@/integrations/supabase/client";

export interface ProfileCustomization {
  username_css: string | null;
  username_icon_svg: string | null;
  username_icon_fill: string | null;
  username_icon_stroke: string | null;
  profile_badge_text: string | null;
  profile_badge_css: string | null;
}

const customizationCache = new Map<string, ProfileCustomization | null>();

export const getProfileCustomization = async (userId: string): Promise<ProfileCustomization | null> => {
  // Check cache first
  if (customizationCache.has(userId)) {
    return customizationCache.get(userId) || null;
  }

  try {
    const { data, error } = await supabase
      .from("profile_customization")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error("Error loading customization:", error);
      customizationCache.set(userId, null);
      return null;
    }

    const customization = data || null;
    customizationCache.set(userId, customization);
    return customization;
  } catch (error) {
    console.error("Error loading customization:", error);
    customizationCache.set(userId, null);
    return null;
  }
};

export const parseCssToStyle = (css: string): React.CSSProperties => {
  const style: React.CSSProperties = {};
  
  if (!css) return style;

  const declarations = css.split(';').filter(s => s.trim());
  
  declarations.forEach(decl => {
    // Split on first colon only, as values may contain colons (e.g., url(...), rgba(...))
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) return;
    
    const property = decl.substring(0, colonIndex).trim();
    const value = decl.substring(colonIndex + 1).trim();
    
    if (!property || !value) return;

    // Convert CSS property to React style property
    const reactProperty = property
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^webkit/, 'Webkit')
      .replace(/^moz/, 'Moz')
      .replace(/^ms/, 'Ms');

    // Handle special cases
    if (reactProperty === 'webkitBackgroundClip') {
      style.WebkitBackgroundClip = value as string;
    } else if (reactProperty === 'webkitTextFillColor') {
      style.WebkitTextFillColor = value as string;
    } else if (reactProperty === 'background') {
      style.background = value;
    } else if (reactProperty === 'backgroundImage') {
      style.backgroundImage = value;
    } else if (reactProperty === 'backgroundColor') {
      style.backgroundColor = value;
    } else if (reactProperty === 'color') {
      style.color = value;
    } else if (reactProperty === 'textShadow') {
      style.textShadow = value;
    } else if (reactProperty === 'boxShadow') {
      style.boxShadow = value;
    } else if (reactProperty === 'borderRadius') {
      style.borderRadius = value;
    } else {
      (style as Record<string, string | undefined>)[reactProperty] = value;
    }
  });

  return style;
};

export const clearCustomizationCache = (userId?: string) => {
  if (userId) {
    customizationCache.delete(userId);
  } else {
    customizationCache.clear();
  }
};
