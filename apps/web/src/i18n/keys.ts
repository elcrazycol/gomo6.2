import ru from "./locales/ru";

export interface PluralForm {
  form: string;
  source: string;
}

export interface SourceKey {
  /** Dotted base key, e.g. "common.save" or "common.posts" (no plural suffix). */
  key: string;
  namespace: string;
  /** Display source text (Russian). */
  source: string;
  plural: boolean;
  forms: PluralForm[];
}

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

/**
 * Flatten the bundled Russian locale into a list of translatable keys, grouping
 * plural forms (posts_one / posts_few / …) under a single base key so the
 * editor shows one card per logical string — the same model Telegram uses.
 */
export function getSourceKeys(): SourceKey[] {
  const result: SourceKey[] = [];
  const namespaces = ru as unknown as Record<string, Record<string, string>>;

  for (const [ns, entries] of Object.entries(namespaces)) {
    interface Group {
      plain: string | null;
      forms: PluralForm[];
    }
    const grouped = new Map<string, Group>();

    for (const [leaf, source] of Object.entries(entries)) {
      const m = leaf.match(new RegExp(`^(.*)_(${PLURAL_SUFFIXES.join("|")})$`));
      if (m) {
        const base = m[1];
        const form = m[2];
        const g = grouped.get(base) ?? { plain: null, forms: [] };
        g.forms.push({ form, source });
        grouped.set(base, g);
      } else {
        const g = grouped.get(leaf) ?? { plain: null, forms: [] };
        g.plain = source;
        grouped.set(leaf, g);
      }
    }

    for (const [base, g] of grouped.entries()) {
      if (g.forms.length > 0) {
        result.push({
          key: `${ns}.${base}`,
          namespace: ns,
          source: g.forms.map((f) => f.source).join(" · "),
          plural: true,
          forms: g.forms.sort((a, b) => PLURAL_SUFFIXES.indexOf(a.form) - PLURAL_SUFFIXES.indexOf(b.form)),
        });
      } else if (g.plain != null) {
        result.push({ key: `${ns}.${base}`, namespace: ns, source: g.plain, plural: false, forms: [] });
      }
    }
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/** The dotted storage key for one plural form of a base key. */
export function pluralFormKey(baseKey: string, form: string): string {
  return `${baseKey}_${form}`;
}

/** Namespace names in a stable order for the editor sections. */
export function getNamespaces(): string[] {
  const keys = getSourceKeys();
  const set = new Set(keys.map((k) => k.namespace));
  return Array.from(set);
}
