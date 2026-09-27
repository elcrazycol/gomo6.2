import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Info,
  Link2,
  Printer,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  BRAND,
  LEGAL_DATES,
  LEGAL_IS_DRAFT,
  fillLegalText,
  formatLegalDate,
} from "@/lib/legal/config";
import {
  LEGAL_DOCUMENTS,
  type LegalBlock,
  type LegalDocument,
} from "@/lib/legal/documents";
import { LEGAL_DOC_ICONS } from "@/lib/legal/icons";

/** Хук scroll-spy: id секции, которая сейчас у верха экрана. */
const useActiveSection = (ids: string[]): string => {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    if (ids.length === 0) return;
    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);

  return active;
};

/** Тонкая полоса прогресса чтения под хедером. */
const ReadingProgress = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="sticky top-0 z-20 h-0.5 w-full bg-transparent print:hidden" aria-hidden="true">
      <div
        className="h-full bg-primary/70 transition-[width] duration-150 ease-out"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
};

const Callout = ({ tone, title, text }: { tone: "info" | "warn"; title?: string; text: string }) => {
  const warn = tone === "warn";
  const Icon = warn ? AlertTriangle : Info;
  return (
    <div
      className={`flex gap-3 rounded-2xl border p-3.5 sm:p-4 ${
        warn
          ? "border-amber-500/35 bg-amber-500/[0.07]"
          : "border-primary/25 bg-primary/[0.05]"
      }`}
    >
      <span
        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          warn ? "bg-amber-500/15 text-amber-500" : "bg-primary/10 text-primary"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        {title && <p className="text-[13px] font-semibold text-foreground">{title}</p>}
        <p className="text-[13px] leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
};

const Block = ({ block }: { block: LegalBlock }) => {
  if (block.kind === "callout") {
    return (
      <Callout tone={block.tone} title={block.title} text={fillLegalText(block.text)} />
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="space-y-2">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-6 text-muted-foreground">
            <Check className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
            <span>{fillLegalText(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="text-[14px] leading-6 text-muted-foreground">{fillLegalText(block.text)}</p>
  );
};

const Toc = ({
  doc,
  active,
  onJump,
  sticky = false,
}: {
  doc: LegalDocument;
  active: string;
  onJump: (id: string) => void;
  sticky?: boolean;
}) => (
  <nav
    aria-label="Содержание документа"
    className={
      sticky
        ? "max-h-[calc(100vh-8rem)] space-y-0.5 overflow-y-auto pr-1"
        : "mt-2 space-y-0.5 rounded-2xl border border-border/70 bg-surface p-2"
    }
  >
    {doc.sections.map((section) => {
      const isActive = active === section.id;
      return (
        <button
          key={section.id}
          type="button"
          onClick={() => onJump(section.id)}
          className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-[13px] leading-5 transition-colors ${
            isActive
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          {fillLegalText(section.title)}
        </button>
      );
    })}
  </nav>
);

const Meta = ({ label, value }: { label: string; value: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1">
    <span className="text-muted-foreground">{label}:</span>
    <span className="font-medium text-foreground/90">{value}</span>
  </span>
);

interface LegalDocumentViewProps {
  doc: LegalDocument;
}

export const LegalDocumentView = ({ doc }: LegalDocumentViewProps) => {
  const sectionIds = useMemo(() => doc.sections.map((s) => s.id), [doc.sections]);
  const active = useActiveSection(sectionIds);
  const [tocOpen, setTocOpen] = useState(false);
  // Прокрутка к разделу ставится в очередь и выполняется ПОСЛЕ закрытия панели
  // «Содержание». Иначе на мобильном цель уезжает: панель схлопывается уже
  // после scrollIntoView и сдвигает документ вверх на свою высоту.
  const [pendingJump, setPendingJump] = useState<{ id: string; nonce: number } | null>(null);
  const jumpNonce = useRef(0);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [doc.id]);

  useEffect(() => {
    if (!pendingJump) return;
    setPendingJump(null);
    const el = document.getElementById(pendingJump.id);
    if (!el) return;
    // Отступ = высота фиксированной шапки + воздух, а не scroll-margin:
    // считаем вручную, чтобы не зависеть от текущего layout.
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-header-height");
    const headerHeight = Number.parseFloat(raw) || 64;
    const top = window.scrollY + el.getBoundingClientRect().top - headerHeight - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [pendingJump]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/legal/${doc.id}#${active}`);
      toast.success("Ссылка на раздел скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }, [active, doc.id]);

  const jumpTo = useCallback((id: string) => {
    setTocOpen(false);
    jumpNonce.current += 1;
    setPendingJump({ id, nonce: jumpNonce.current });
  }, []);

  const related = doc.related.map((id) => LEGAL_DOCUMENTS[id]).filter(Boolean);

  return (
    <div className="relative">
      <ReadingProgress />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
        <Link
          to="/legal"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground print:hidden"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Все документы
        </Link>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <header className="mt-4 overflow-hidden rounded-[var(--card-radius)] border border-border/70 bg-surface">
          <div className="relative p-5 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                {/* иконка документа */}
                {(() => {
                  const Icon = LEGAL_DOC_ICONS[doc.id] ?? FileText;
                  return <Icon className="h-6 w-6" aria-hidden="true" />;
                })()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold leading-tight sm:text-2xl">
                    {fillLegalText(doc.title)}
                  </h1>
                  {LEGAL_IS_DRAFT && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                      черновик
                    </span>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-[14px] leading-6 text-muted-foreground">
                  {fillLegalText(doc.summary)}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
                  <Meta label="Версия" value={doc.version} />
                  <Meta label="Действует с" value={formatLegalDate(LEGAL_DATES.effectiveFrom)} />
                  <Meta label="Обновлено" value={formatLegalDate(LEGAL_DATES.updatedAt)} />
                </div>
              </div>

              <div className="flex shrink-0 gap-2 print:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={copyLink}
                  title="Скопировать ссылку на текущий раздел"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Ссылка</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => window.print()}
                  title="Печать или сохранение в PDF"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">PDF</span>
                </Button>
              </div>
            </div>
          </div>
        </header>

        {LEGAL_IS_DRAFT && (
          <div className="mt-4">
            <Callout
              tone="warn"
              title="Текст в разработке"
              text="Это черновая версия, а не юридический документ. Формулировки будут переписаны до публичного запуска; использовать их как основание для претензий нельзя."
            />
          </div>
        )}

        {/* ── Оглавление (мобильное) ───────────────────────────────────────── */}
        <div className="mt-4 lg:hidden print:hidden">
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            aria-expanded={tocOpen}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/70 bg-surface px-4 py-3 text-left text-sm font-medium"
          >
            <span className="inline-flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Содержание
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${tocOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {tocOpen && <Toc doc={doc} active={active} onJump={jumpTo} />}
        </div>

        {/* ── Двухколоночный макет ─────────────────────────────────────────── */}
        <div className="mt-6 flex gap-8">
          <aside className="hidden w-64 shrink-0 lg:block print:hidden">
            <div className="sticky top-24">
              <p className="mb-3 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Содержание
              </p>
              <Toc doc={doc} active={active} onJump={jumpTo} sticky />
            </div>
          </aside>

          <article className="min-w-0 flex-1">
            <div className="space-y-8">
              {doc.sections.map((section) => (
                <section key={section.id} id={section.id} className="scroll-mt-24">
                  <h2 className="mb-3 text-base font-semibold leading-snug text-foreground sm:text-lg">
                    {fillLegalText(section.title)}
                  </h2>
                  <div className="space-y-3">
                    {section.blocks.map((block, i) => (
                      <Block key={i} block={block} />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* ── Другие документы + контакты ─────────────────────────────── */}
            {related.length > 0 && (
              <div className="mt-10 space-y-3 print:hidden">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Смотрите также
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {related.map((item) => {
                    const Icon = LEGAL_DOC_ICONS[item.id] ?? FileText;
                    return (
                      <Link
                        key={item.id}
                        to={`/legal/${item.id}`}
                        className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-surface p-3.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground transition-colors group-hover:text-primary">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {fillLegalText(item.title)}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                            {fillLegalText(item.summary)}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-border/70 bg-surface p-4 sm:p-5 print:hidden">
              <p className="text-sm font-semibold text-foreground">Не нашли ответ?</p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                Напишите нам — мы читаем все обращения. Тематический адрес зависит от вопроса,
                общий контакт один: {BRAND.domain}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={`mailto:${fillLegalText("{{contact}}")}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-muted/60"
                >
                  Написать в поддержку
                </a>
                <Link
                  to="/legal"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Все документы
                </Link>
              </div>
            </div>
          </article>
        </div>
      </div>

      {/* Кнопка «наверх» — только на длинных документах */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Наверх"
        className="fixed bottom-5 right-5 z-30 grid h-10 w-10 place-items-center rounded-full border border-border/70 bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground print:hidden"
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export default LegalDocumentView;
