import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";

// Dismissal is per-tab-session: once a guest closes the banner it stays hidden
// until they open a new tab. sessionStorage (not localStorage) so a shared
// device never remembers the dismissal for the next visitor.
const DISMISS_KEY = "guest-signup-banner-dismissed";

/**
 * Small, collapsible CTA shown to anonymous visitors: invites them to create
 * an account so they can keep enjoying (and participating in) the content.
 * Rendered only by AppLayout when there is no authenticated user.
 */
export const GuestSignupBanner = () => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(94vw,560px)]">
      <div className="flex items-center gap-2 sm:gap-3 rounded-2xl border border-primary/25 bg-card/95 backdrop-blur-md shadow-lg shadow-black/10 pl-3 pr-1.5 py-1.5 sm:py-2 animate-in slide-in-from-bottom-4 fade-in duration-300">
        <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-primary" />
        <p className="text-xs sm:text-sm text-muted-foreground leading-tight flex-1 min-w-0">
          Нравится то, что видишь?{" "}
          <span className="text-foreground font-semibold">Зарегистрируйся</span>{" "}
          — это займёт минуту.
        </p>
        <Button
          size="sm"
          onClick={() => navigate("/auth")}
          className="h-7 sm:h-8 shrink-0 rounded-full px-3 sm:px-4 text-xs sm:text-sm transition-transform hover:scale-[1.03] active:scale-[0.97]"
        >
          Создать аккаунт
        </Button>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignore
            }
            setDismissed(true);
          }}
          className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Скрыть предложение зарегистрироваться"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
