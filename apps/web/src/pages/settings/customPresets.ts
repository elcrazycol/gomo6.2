export interface UsernamePreset {
  id: string;
  name: string;
  nameRu: string;
  css: string;
  previewColor: string;
}

export interface BadgePreset {
  id: string;
  name: string;
  nameRu: string;
  css: string;
  previewColor: string;
}

export const usernamePresets: UsernamePreset[] = [
  {
    id: "fire",
    name: "Fire",
    nameRu: "Огонь",
    css: "color: #ff4500; text-shadow: 0 0 4px #ff4500, 0 0 8px #ff6600",
    previewColor: "#ff4500",
  },
  {
    id: "ice",
    name: "Ice",
    nameRu: "Лёд",
    css: "color: #00d4ff; text-shadow: 0 0 4px #00d4ff, 0 0 8px #0099cc",
    previewColor: "#00d4ff",
  },
  {
    id: "neon-pink",
    name: "Neon Pink",
    nameRu: "Неон розовый",
    css: "color: #ff2d95; text-shadow: 0 0 4px #ff2d95, 0 0 12px #ff2d95",
    previewColor: "#ff2d95",
  },
  {
    id: "gold",
    name: "Gold",
    nameRu: "Золото",
    css: "color: #ffd700; text-shadow: 0 0 3px #ffd700, 0 1px 2px rgba(0,0,0,0.5)",
    previewColor: "#ffd700",
  },
  {
    id: "matrix",
    name: "Matrix",
    nameRu: "Матрица",
    css: "color: #00ff41; text-shadow: 0 0 5px #00ff41, 0 0 10px #00ff41",
    previewColor: "#00ff41",
  },
  {
    id: "gradient-sunset",
    name: "Sunset",
    nameRu: "Закат",
    css: "background: linear-gradient(90deg, #ff6b35, #f7c948, #ff6b35); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-size: 200% auto; animation: gradient-shift 3s linear infinite",
    previewColor: "#ff6b35",
  },
  {
    id: "gradient-ocean",
    name: "Ocean",
    nameRu: "Океан",
    css: "background: linear-gradient(90deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent",
    previewColor: "#667eea",
  },
  {
    id: "glow-white",
    name: "Glow",
    nameRu: "Свечение",
    css: "color: #ffffff; text-shadow: 0 0 4px rgba(255,255,255,0.8), 0 0 8px rgba(255,255,255,0.4)",
    previewColor: "#ffffff",
  },
  {
    id: "retro",
    name: "Retro",
    nameRu: "Ретро",
    css: "color: #ff6b6b; text-shadow: 2px 2px 0 #feca57, 4px 4px 0 #ff9ff3",
    previewColor: "#ff6b6b",
  },
  {
    id: "shadow-depth",
    name: "Depth",
    nameRu: "Глубина",
    css: "color: #e0e0e0; text-shadow: 0 1px 0 #999, 0 2px 0 #888, 0 3px 0 #777, 0 4px 0 #666, 0 5px 0 #555, 0 6px 1px rgba(0,0,0,0.1), 0 0 5px rgba(0,0,0,0.1)",
    previewColor: "#e0e0e0",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    nameRu: "Киберпанк",
    css: "background: linear-gradient(135deg, #f72585, #7209b7, #3a0ca3, #4cc9f0); -webkit-background-clip: text; -webkit-text-fill-color: transparent",
    previewColor: "#f72585",
  },
  {
    id: "subtle",
    name: "Subtle",
    nameRu: "Утончённый",
    css: "color: #b8b8d0; font-style: italic",
    previewColor: "#b8b8d0",
  },
];

export const badgePresets: BadgePreset[] = [
  {
    id: "vip-gold",
    name: "VIP Gold",
    nameRu: "VIP золотой",
    css: "color: #1a1a2e; background: linear-gradient(135deg, #ffd700, #ffaa00); font-weight: bold; text-shadow: none; box-shadow: 0 0 6px rgba(255,215,0,0.4)",
    previewColor: "#ffd700",
  },
  {
    id: "mod-blue",
    name: "Moderator",
    nameRu: "Модератор",
    css: "color: #fff; background: linear-gradient(135deg, #2563eb, #1d4ed8); font-weight: bold; box-shadow: 0 0 6px rgba(37,99,235,0.3)",
    previewColor: "#2563eb",
  },
  {
    id: "admin-red",
    name: "Admin",
    nameRu: "Админ",
    css: "color: #fff; background: linear-gradient(135deg, #dc2626, #b91c1c); font-weight: bold; box-shadow: 0 0 6px rgba(220,38,38,0.3)",
    previewColor: "#dc2626",
  },
  {
    id: "dev-purple",
    name: "Developer",
    nameRu: "Разработчик",
    css: "color: #fff; background: linear-gradient(135deg, #8b5cf6, #7c3aed); font-weight: bold; box-shadow: 0 0 6px rgba(139,92,246,0.3)",
    previewColor: "#8b5cf6",
  },
  {
    id: "neon-green",
    name: "Neon",
    nameRu: "Неон",
    css: "color: #00ff88; background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.3); text-shadow: 0 0 4px #00ff88; font-weight: bold",
    previewColor: "#00ff88",
  },
  {
    id: "glass",
    name: "Glass",
    nameRu: "Стекло",
    css: "color: #fff; background: rgba(255,255,255,0.1); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2); font-weight: bold",
    previewColor: "#ffffff",
  },
  {
    id: "sunset-badge",
    name: "Sunset",
    nameRu: "Закат",
    css: "color: #fff; background: linear-gradient(135deg, #f97316, #ec4899); font-weight: bold; box-shadow: 0 0 8px rgba(249,115,22,0.3)",
    previewColor: "#f97316",
  },
  {
    id: "minimal",
    name: "Minimal",
    nameRu: "Минимал",
    css: "color: var(--primary); background: transparent; border: 1px solid var(--primary); font-weight: bold",
    previewColor: "var(--primary)",
  },
];
