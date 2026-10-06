import { ArrowRight, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BRAND, LEGAL_IS_DRAFT, fillLegalText } from "@/lib/legal/config";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
import { LEGAL_DOC_ICONS } from "@/lib/legal/icons";

const ConsentDocLink = ({
  to,
  icon,
  title,
  summary,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  summary: string;
}) => (
  <Link
    to={to}
    className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-surface p-3.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
  >
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground transition-colors group-hover:text-primary">
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-foreground">{title}</span>
      <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">{summary}</span>
    </span>
    <ArrowRight
      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      aria-hidden="true"
    />
  </Link>
);

interface LegalConsentGateProps {
  open: boolean;
  /** Версия, которую предлагается принять. */
  version: string;
  /** Ранее принятая версия, если запись уже была (для текста «что изменилось»). */
  previousVersion?: string | null;
  onAccept: () => void;
  /** Закрыть без согласия — чтение мы не блокируем. */
  onDismiss: () => void;
}

/**
 * Подтверждение документов после входа.
 *
 * Раньше на этом месте была модалка, которую нельзя было закрыть: она
 * появлялась «в случайный момент» и блокировала весь сайт. Теперь это
 * одноразовое вежливое подтверждение: можно прочитать документы, принять или
 * отложить (тогда оно вернётся в следующей сессии).
 */
export const LegalConsentGate = ({
  open,
  version,
  previousVersion,
  onAccept,
  onDismiss,
}: LegalConsentGateProps) => {
  const updated = Boolean(previousVersion && previousVersion !== version);
  const terms = LEGAL_DOCUMENTS.terms;
  const privacy = LEGAL_DOCUMENTS.privacy;
  const TermsIcon = LEGAL_DOC_ICONS.terms;
  const PrivacyIcon = LEGAL_DOC_ICONS.privacy;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="relative border-b border-border/70 bg-surface p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
          <DialogHeader className="relative">
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ScrollText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg">
                  {updated ? "Документы обновились" : `Подтвердите согласие с ${BRAND.name}`}
                </DialogTitle>
                {LEGAL_IS_DRAFT && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                    черновик
                  </span>
                )}
              </div>
            </div>
            <DialogDescription className="pt-2 text-[13px] leading-5">
              {updated
                ? `Мы обновили документы (версия ${previousVersion} → ${version}). Ниже — короткая суть и ссылки на полный текст.`
                : `Чтобы публиковать и общаться, нужно принять документы ${BRAND.name}. Это одна версия (${version}) и не займёт много времени.`}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-3 p-5 sm:p-6">
          {/* Иконки берём из общего реестра документов — один источник правды. */}
          <ConsentDocLink
            to="/legal/terms"
            icon={<TermsIcon className="h-4 w-4" aria-hidden="true" />}
            title={fillLegalText(terms.title)}
            summary="Правила использования, права на контент, модерация, ответственность."
          />
          <ConsentDocLink
            to="/legal/privacy"
            icon={<PrivacyIcon className="h-4 w-4" aria-hidden="true" />}
            title={fillLegalText(privacy.title)}
            summary="Какие данные мы обрабатываем, зачем, кому передаём и как удалить."
          />

          <p className="text-[12px] leading-5 text-muted-foreground">
            Продолжая, вы подтверждаете, что ознакомились с{" "}
            <Link to="/legal/rules" className="text-primary hover:underline">
              Правилами сообщества
            </Link>{" "}
            и принимаете их. Читать сайт можно и без подтверждения — оно нужно для действий:
            публикаций, сообщений и загрузок.
          </p>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="rounded-full" onClick={onDismiss}>
              Позже
            </Button>
            <Button className="rounded-full" onClick={onAccept}>
              Принять и продолжить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LegalConsentGate;
