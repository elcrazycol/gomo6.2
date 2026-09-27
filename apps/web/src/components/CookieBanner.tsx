import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, ChevronDown, Cookie, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  getConsent,
  hasDecided,
  OPEN_SETTINGS_EVENT,
  saveConsent,
} from "@/lib/cookieConsent";

/** Let the first paint settle before sliding in — a banner over a blank page reads as a popup. */
const SHOW_DELAY_MS = 600;

/**
 * Cookie consent, in the modern shape: a compact bar by default, a settings
 * view with per-category switches behind «Настроить». The choice is persisted
 * (see lib/cookieConsent) and actually drives the app — analytics only starts
 * once the category is granted.
 */
export const CookieBanner = () => {
  const [decided, setDecided] = useState(() => hasDecided());
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(() => getConsent()?.analytics ?? false);

  useEffect(() => {
    if (decided) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [decided]);

  // The footer's «Куки» link re-opens the banner, straight into the settings.
  useEffect(() => {
    const onOpen = () => {
      setAnalytics(getConsent()?.analytics ?? false);
      setExpanded(true);
      setDecided(false);
      setVisible(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  const decide = (choice: { analytics: boolean }) => {
    saveConsent(choice);
    setDecided(true);
  };

  if (decided || !visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:p-4">
      <div className="mx-auto w-full max-w-3xl animate-in slide-in-from-bottom-4 fade-in rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl shadow-black/25 backdrop-blur-md duration-300 sm:p-5 motion-reduce:animate-none">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Cookie className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">Мы используем куки</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Необходимые держат вас в аккаунте и защищают запросы — без них сайт не работает.
              С вашего согласия добавляем анонимную аналитику: ошибки и скорость, чтобы видеть, что
              тормозит. Рекламных куки и профилирования нет.
            </p>
          </div>
        </div>

        {expanded ? (
          <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
            {/* eslint-disable-next-line @typescript-eslint/no-use-before-define -- small renderer, defined below for readability */}
            <CategoryRow
              title="Необходимые"
              description="Авторизация, защита от CSRF, сохранение настроек интерфейса."
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              locked
            />
            {/* eslint-disable-next-line @typescript-eslint/no-use-before-define -- small renderer, defined below for readability */}
            <CategoryRow
              title="Аналитика"
              description="Анонимная статистика ошибок и замеры производительности (Sentry)."
              icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
              checked={analytics}
              onChange={setAnalytics}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" className="rounded-full" onClick={() => decide({ analytics })}>
                Сохранить выбор
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => decide({ analytics: false })}
              >
                Только необходимые
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => decide({ analytics: true })}
              >
                Принять все
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" className="rounded-full" onClick={() => decide({ analytics: true })}>
              Принять все
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => decide({ analytics: false })}
            >
              Только необходимые
            </Button>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Настроить
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const CategoryRow = ({
  title,
  description,
  icon,
  locked = false,
  checked = false,
  onChange,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  locked?: boolean;
  checked?: boolean;
  onChange?: (value: boolean) => void;
}) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground">
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {locked && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            всегда
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{description}</p>
    </div>
    <Switch
      checked={locked ? true : checked}
      disabled={locked}
      onCheckedChange={onChange}
      aria-label={title}
      className="mt-0.5"
    />
  </div>
);
