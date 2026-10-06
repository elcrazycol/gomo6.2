import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { CONSENT_EVENT, hasDecided } from "@/lib/cookieConsent";

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
  // While the cookie banner is up (bottom, z-70) this CTA floats above it;
  // once the visitor has made a cookie choice it settles to the bottom edge.
  const [cookiesDone, setCookiesDone] = useState(hasDecided);

  useEffect(() => {
    const onConsent = () => setCookiesDone(hasDecided());
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);

  if (dismissed) return null;

  // z-[60] keeps the CTA above the cookie strip (z-50); while the strip is
  // visible the CTA floats above it (bottom-24 on mobile where the strip wraps
  // to two lines, bottom-20 on larger screens), otherwise it rests on the
  // bottom edge.
  return (
    <div className={`fixed left-1/2 -translate-x-1/2 z-[60] w-[min(94vw,560px)] transition-all duration-300 ${
      cookiesDone
        ? "bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:bottom-[max(1rem,env(safe-area-inset-bottom,0px))]"
        : "bottom-24 sm:bottom-20"
    }`}>
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
