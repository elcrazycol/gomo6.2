import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Search, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { getSourceKeys, getNamespaces, pluralFormKey, type SourceKey } from "@/i18n/keys";
import { getActiveLanguage, loadCommunityTranslations } from "@/i18n";
import { LANGUAGES } from "@/i18n/languages";
import {
  listTranslations,
  submitTranslation,
  voteTranslation,
  deleteTranslation,
  type TranslationProposal,
} from "@/integrations/api/translations";

interface Entry {
  storageKey: string;
  /** Plural form label ("one"/"few"/…) or empty for non-plural keys. */
  form: string;
  source: string;
}

function rankProposals(a: TranslationProposal, b: TranslationProposal): number {
  const votes = b.votes - a.votes;
  if (votes !== 0) return votes;
  return b.created_at.localeCompare(a.created_at);
}

function entriesFor(key: SourceKey): Entry[] {
  if (!key.plural) return [{ storageKey: key.key, form: "", source: key.source }];
  return key.forms.map((f) => ({
    storageKey: pluralFormKey(key.key, f.form),
    form: f.form,
    source: f.source,
  }));
}

const Translate = () => {
  const { t } = useTranslation();
  const sourceKeys = useMemo(() => getSourceKeys(), []);
  const namespaces = useMemo(() => getNamespaces(), []);
  const [targetLang, setTargetLang] = useState("en");
  const [query, setQuery] = useState("");
  const [proposals, setProposals] = useState<Map<string, TranslationProposal[]>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listTranslations(targetLang);
      const next = new Map<string, TranslationProposal[]>();
      for (const row of rows) {
        const arr = next.get(row.key) ?? [];
        arr.push(row);
        next.set(row.key, arr.sort(rankProposals));
      }
      setProposals(next);
    } catch {
      toast.error(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [targetLang, t]);

  useEffect(() => {
    load();
  }, [load]);

  const translatedCount = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const key of sourceKeys) {
      for (const entry of entriesFor(key)) {
        total++;
        const list = proposals.get(entry.storageKey);
        if (list && list.length > 0) done++;
      }
    }
    return { total, done };
  }, [sourceKeys, proposals]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sourceKeys;
    return sourceKeys.filter(
      (k) => k.key.toLowerCase().includes(q) || k.source.toLowerCase().includes(q)
    );
  }, [sourceKeys, query]);

  const completionPercent = translatedCount.total === 0
    ? 0
    : Math.round((translatedCount.done / translatedCount.total) * 100);

  const refreshActiveLocale = async () => {
    if (getActiveLanguage() === targetLang) {
      await loadCommunityTranslations(targetLang);
    }
  };

  const markBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleSubmit = async (entry: Entry) => {
    const value = (drafts.get(entry.storageKey) ?? "").trim();
    if (!value) return;
    markBusy(entry.storageKey, true);
    try {
      const created = await submitTranslation({ key: entry.storageKey, locale: targetLang, value });
      setProposals((prev) => {
        const next = new Map(prev);
        const arr = [...(next.get(entry.storageKey) ?? [])];
        arr.push(created);
        next.set(entry.storageKey, arr.sort(rankProposals));
        return next;
      });
      await refreshActiveLocale();
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(entry.storageKey);
        return next;
      });
    } catch {
      toast.error(t("common.error"));
    } finally {
      markBusy(entry.storageKey, false);
    }
  };

  const handleVote = async (proposal: TranslationProposal, direction: 1 | -1) => {
    const id = `${proposal.id}:${direction}`;
    markBusy(id, true);
    try {
      const { votes, my_vote } = await voteTranslation(proposal.id, direction);
      setProposals((prev) => {
        const next = new Map(prev);
        const arr = (next.get(proposal.key) ?? []).map((p) =>
          p.id === proposal.id ? { ...p, votes, my_vote } : p
        );
        next.set(proposal.key, arr.sort(rankProposals));
        return next;
      });
      await refreshActiveLocale();
    } catch {
      toast.error(t("common.error"));
    } finally {
      markBusy(id, false);
    }
  };

  const handleDelete = async (proposal: TranslationProposal) => {
    markBusy(`del:${proposal.id}`, true);
    try {
      await deleteTranslation(proposal.id);
      setProposals((prev) => {
        const next = new Map(prev);
        const arr = (next.get(proposal.key) ?? []).filter((p) => p.id !== proposal.id);
        next.set(proposal.key, arr.sort(rankProposals));
        return next;
      });
      // Reloading also clears a stale runtime override if the deleted proposal
      // was the winner and no fallback proposal remains.
      await refreshActiveLocale();
    } catch {
      toast.error(t("common.error"));
    } finally {
      markBusy(`del:${proposal.id}`, false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-4 pb-24">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold mb-1">{t("nav.translate")}</h1>
        <p className="text-muted-foreground text-sm">
          {translatedCount.done}/{translatedCount.total} · {completionPercent}% · {targetLang}
        </p>
        <div
          className="mx-auto mt-2 h-2 max-w-xs overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`${completionPercent}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionPercent}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Select value={targetLang} onValueChange={setTargetLang}>
          <SelectTrigger className="sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.filter((l) => l.code !== "ru").map((l) => (
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("common.search")}
            className="pl-9"
          />
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground text-center py-8">{t("common.loading")}</p>}

      <div className="space-y-4">
        {namespaces.map((ns) => {
          const keys = filtered.filter((k) => k.namespace === ns);
          if (keys.length === 0) return null;
          return (
            <NamespaceSection
              key={ns}
              ns={ns}
              keys={keys}
              proposals={proposals}
              drafts={drafts}
              busy={busy}
              onDraft={(k, v) =>
                setDrafts((prev) => {
                  const next = new Map(prev);
                  next.set(k, v);
                  return next;
                })
              }
              onSubmit={handleSubmit}
              onVote={handleVote}
              onDelete={handleDelete}
            />
          );
        })}
      </div>
    </main>
  );
};

interface NamespaceSectionProps {
  ns: string;
  keys: SourceKey[];
  proposals: Map<string, TranslationProposal[]>;
  drafts: Map<string, string>;
  busy: Set<string>;
  onDraft: (key: string, value: string) => void;
  onSubmit: (entry: Entry) => void;
  onVote: (p: TranslationProposal, d: 1 | -1) => void;
  onDelete: (p: TranslationProposal) => void;
}

function NamespaceSection(props: NamespaceSectionProps) {
  const { ns, keys, proposals, drafts, busy, onDraft, onSubmit, onVote, onDelete } = props;
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full bg-card border border-border px-4 py-3 text-left flex items-center justify-between hover:bg-muted/50 transition-colors">
          <span className="font-semibold">{ns}</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        {keys.map((key) => (
          <KeyCard
            key={key.key}
            sourceKey={key}
            entries={entriesFor(key)}
            proposals={proposals}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onSubmit={onSubmit}
            onVote={onVote}
            onDelete={onDelete}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function KeyCard({
  sourceKey,
  entries,
  proposals,
  drafts,
  busy,
  onDraft,
  onSubmit,
  onVote,
  onDelete,
}: {
  sourceKey: SourceKey;
  entries: Entry[];
  proposals: Map<string, TranslationProposal[]>;
  drafts: Map<string, string>;
  busy: Set<string>;
  onDraft: (key: string, value: string) => void;
  onSubmit: (entry: Entry) => void;
  onVote: (p: TranslationProposal, d: 1 | -1) => void;
  onDelete: (p: TranslationProposal) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-lg p-3 sm:p-4">
      <div className="mb-2">
        <code className="text-[11px] text-muted-foreground">{sourceKey.key}</code>
        <p className="text-sm mt-0.5">{sourceKey.source}</p>
      </div>

      {entries.map((entry) => {
        const list = proposals.get(entry.storageKey) ?? [];
        return (
          <div key={entry.storageKey} className="mt-3 first:mt-0">
            {entry.form && (
              <span className="inline-block text-[11px] uppercase text-muted-foreground mb-1">
                {entry.form}
              </span>
            )}
            {list.map((p) => (
              <div key={p.id} className="flex items-start gap-2 py-1">
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={busy.has(`${p.id}:1`)}
                    onClick={() => onVote(p, 1)}
                    aria-label="+1"
                    className={`p-1 rounded hover:bg-muted ${p.my_vote === 1 ? "text-primary" : "text-muted-foreground"}`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <span className={`text-xs w-6 text-center ${p.votes > 0 ? "text-primary" : p.votes < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {p.votes}
                  </span>
                  <button
                    type="button"
                    disabled={busy.has(`${p.id}:-1`)}
                    onClick={() => onVote(p, -1)}
                    aria-label="-1"
                    className={`p-1 rounded hover:bg-muted ${p.my_vote === -1 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm break-words">{p.value}</p>
                  <p className="text-[11px] text-muted-foreground">{p.username || t("common.anonymous")}</p>
                </div>
                {p.my_vote !== 0 && (
                  <button
                    type="button"
                    disabled={busy.has(`del:${p.id}`)}
                    onClick={() => onDelete(p)}
                    aria-label={t("common.delete")}
                    className="p-1 rounded hover:bg-muted text-muted-foreground shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}

            <div className="flex gap-2 mt-1">
              <Textarea
                value={drafts.get(entry.storageKey) ?? ""}
                onChange={(e) => onDraft(entry.storageKey, e.target.value)}
                placeholder={t("common.translatePlaceholder")}
                className="min-h-[40px] text-sm"
                rows={1}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy.has(entry.storageKey) || !(drafts.get(entry.storageKey) ?? "").trim()}
                onClick={() => onSubmit(entry)}
                className="self-start shrink-0"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Translate;
