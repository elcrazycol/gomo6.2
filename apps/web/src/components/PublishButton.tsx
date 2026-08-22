import { ArrowRight, Loader2, Rocket, Send } from "lucide-react";
import type { PublishButtonStyle } from "@/lib/publishButtonStyle";

interface PublishButtonProps {
  style: PublishButtonStyle;
  creating?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Overrides the default «Опубликовать» label (e.g. «Сохранить» in edit mode). */
  label?: string;
}

/**
 * The g-sub composer publish button. The visual style is user-selectable in
 * Settings → Appearance → «Кнопка публикации».
 */
export const PublishButton = ({ style, creating = false, disabled = false, onClick, label = "Опубликовать" }: PublishButtonProps) => {
  const spinner = <Loader2 className="h-4 w-4 animate-spin" />;

  if (style === "text-link") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || creating}
        className="group inline-flex h-9 items-center gap-1 rounded-md px-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
      >
        {creating ? (
          spinner
        ) : (
          <>
            {label}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    );
  }

  if (style === "send-circle") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || creating}
        title={label}
        aria-label={label}
        className="group inline-flex h-9 items-center rounded-full bg-gradient-to-r from-primary to-accent px-2.5 text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.35)] transition-all hover:brightness-110 hover:shadow-[0_4px_22px_hsl(var(--primary)/0.5)] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
      >
        {creating ? (
          spinner
        ) : (
          <Send className="h-4 w-4 shrink-0" />
        )}
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-[140px] group-hover:opacity-100">
          {label}
        </span>
      </button>
    );
  }

  if (style === "neon-pill") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || creating}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-primary transition-all hover:shadow-[0_0_18px_hsl(var(--primary)/0.4)] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        style={{
          border: "1.5px solid transparent",
          background:
            "linear-gradient(hsl(var(--card)), hsl(var(--card))) padding-box, linear-gradient(120deg, hsl(var(--primary)), hsl(var(--accent))) border-box",
        }}
      >
        {creating ? spinner : <Send className="h-4 w-4 -ml-0.5" />}
        {label}
      </button>
    );
  }

  if (style === "icon-pill") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || creating}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
      >
        {creating ? spinner : <Rocket className="h-4 w-4 -ml-0.5" />}
        {label}
      </button>
    );
  }

  // gradient-pill (default)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || creating}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-accent px-4 text-sm font-semibold text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.35)] transition-all hover:brightness-110 hover:shadow-[0_4px_22px_hsl(var(--primary)/0.5)] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
    >
      {creating ? spinner : <Send className="h-4 w-4 -ml-0.5" />}
      {label}
    </button>
  );
};
