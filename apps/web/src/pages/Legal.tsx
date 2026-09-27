import { Link, useParams } from "react-router-dom";
import { ArrowRight, FileText, Landmark } from "lucide-react";

import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { Button } from "@/components/ui/button";
import { BRAND, LEGAL_DATES, LEGAL_IS_DRAFT, fillLegalText, formatLegalDate } from "@/lib/legal/config";
import { LEGAL_DOC_ICONS } from "@/lib/legal/icons";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOC_ORDER,
  isLegalDocId,
  type LegalDocId,
} from "@/lib/legal/documents";

const LegalIndex = ({ notFound }: { notFound: boolean }) => (
  <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
    <header className="overflow-hidden rounded-[var(--card-radius)] border border-border/70 bg-surface">
      <div className="relative p-5 sm:p-8">
        <div className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Landmark className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight sm:text-2xl">Правовая информация</h1>
              {LEGAL_IS_DRAFT && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                  черновик
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-muted-foreground">
              Документы, которые описывают правила {BRAND.name} и то, как мы обращаемся с данными.
              Мы стараемся писать их человеческим языком, без юридического тумана.
            </p>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Обновлено {formatLegalDate(LEGAL_DATES.updatedAt)}. Тексты ещё дорабатываются — это
              черновики.
            </p>
          </div>
        </div>
      </div>
    </header>

    {notFound && (
      <p className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-3.5 text-[13px] text-muted-foreground">
        Такого документа нет — возможно, ссылка устарела. Ниже — все актуальные.
      </p>
    )}

    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {LEGAL_DOC_ORDER.map((id: LegalDocId) => {
        const doc = LEGAL_DOCUMENTS[id];
        const Icon = LEGAL_DOC_ICONS[id] ?? FileText;
        return (
          <Link
            key={id}
            to={`/legal/${id}`}
            className="group flex flex-col gap-3 rounded-[var(--card-radius)] border border-border/70 bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                  {fillLegalText(doc.title)}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  {fillLegalText(doc.summary)}
                </p>
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
              <span>Версия {doc.version}</span>
              <span className="inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Открыть
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
          </Link>
        );
      })}
    </div>

    <div className="mt-8 flex flex-wrap items-center gap-3 rounded-[var(--card-radius)] border border-border/70 bg-surface p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Нужно изменить решение по cookie?</p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Согласие можно пересмотреть в любой момент — оно открывает те же настройки, что и ссылка
          «Куки» в подвале сайта.
        </p>
      </div>
      <Button asChild variant="outline" className="rounded-full">
        <Link to="/settings">Открыть настройки</Link>
      </Button>
    </div>
  </div>
);

/** `/legal/:docId` → документ; без параметра — список всех документов. */
const Legal = () => {
  const { docId } = useParams<{ docId?: string }>();

  if (isLegalDocId(docId)) {
    return <LegalDocumentView doc={LEGAL_DOCUMENTS[docId]} />;
  }

  return <LegalIndex notFound={Boolean(docId)} />;
};

export default Legal;
