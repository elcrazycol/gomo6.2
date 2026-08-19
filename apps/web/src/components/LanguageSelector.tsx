import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguageStore } from "@/stores/languageStore";
import { LANGUAGES } from "@/i18n/languages";

interface LanguageSelectorProps {
  userId?: string | null;
}

/**
 * Language picker. The choice is applied immediately and persisted server-side
 * for signed-in users (profile_customization.language) plus locally for guests.
 */
export function LanguageSelector({ userId }: LanguageSelectorProps) {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const changeLanguage = useLanguageStore((s) => s.changeLanguage);

  const handleLanguageChange = async (code: string) => {
    try {
      await changeLanguage(code, userId);
    } catch (error) {
      // The local language and community catalog may already be applied. A
      // profile persistence failure (for example while the backend is being
      // migrated) must not become an unhandled promise rejection.
      console.error("Failed to change language", error);
    }
  };

  const known = LANGUAGES.some((l) => l.code === language);
  const options = known
    ? LANGUAGES
    : [{ code: language, name: language, nativeName: language, flag: "🌐" }, ...LANGUAGES];

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-muted-foreground" />
        <div>
          <Label className="text-sm font-semibold">{t("settings.language")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.languageDescription")}</p>
        </div>
      </div>
      <Select value={language} onValueChange={(code) => { void handleLanguageChange(code); }}>
        <SelectTrigger className="w-[180px]" aria-label={t("settings.language")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              <span className="inline-flex items-center gap-2">
                <span>{l.flag}</span>
                <span>{l.nativeName}</span>
                <span className="text-xs text-muted-foreground">({l.code})</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
