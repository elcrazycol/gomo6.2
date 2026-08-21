/**
 * Publish button style — user picks one in Settings → Appearance, and the
 * g-sub composer renders the publish button in that style.
 */

export type PublishButtonStyle = "gradient-pill" | "send-circle" | "text-link" | "neon-pill" | "icon-pill";

export const PUBLISH_BUTTON_STYLE_KEY = "publish-button-style";

export const PUBLISH_BUTTON_STYLES: { id: PublishButtonStyle; label: string; description: string }[] = [
  { id: "gradient-pill", label: "Пилюля с градиентом", description: "Сочный градиент и мягкое свечение, как в Telegram" },
  { id: "send-circle", label: "Круглая отправка", description: "Только иконка, на десктопе раскрывается в «Опубликовать»" },
  { id: "text-link", label: "Текст-ссылка", description: "Без фона — «Опубликовать →» с анимацией" },
  { id: "neon-pill", label: "Неоновая рамка", description: "Прозрачный фон с градиентной рамкой, загорается на наведении" },
  { id: "icon-pill", label: "Пилюля с иконкой", description: "Компактная заливка с иконкой и вдавливанием" },
];

export const getPublishButtonStyle = (): PublishButtonStyle => {
  const saved = localStorage.getItem(PUBLISH_BUTTON_STYLE_KEY);
  return PUBLISH_BUTTON_STYLES.some((s) => s.id === saved) ? (saved as PublishButtonStyle) : "gradient-pill";
};

export const setPublishButtonStyle = (style: PublishButtonStyle): void => {
  localStorage.setItem(PUBLISH_BUTTON_STYLE_KEY, style);
};
