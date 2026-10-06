// Раздел / подраздел taxonomy for global topics.
//
// Both catalogs are read-only (WriteDenied on the backend); they change only
// through migrations, so a simple one-shot fetch per mount is enough.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";

export interface ThreadSection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_nsfw: boolean;
  sort_order: number;
}

export interface ThreadSubsection {
  id: string;
  section_id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
}

export interface SectionWithSubsections extends ThreadSection {
  subsections: ThreadSubsection[];
}

interface UseThreadSectionsResult {
  sections: SectionWithSubsections[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export const useThreadSections = (enabled = true): UseThreadSectionsResult => {
  const [sections, setSections] = useState<SectionWithSubsections[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      const [sectionsRes, subsectionsRes] = await Promise.all([
        api.from("thread_sections").select("*").order("sort_order", { ascending: true }),
        api.from("thread_subsections").select("*").order("sort_order", { ascending: true }),
      ]);

      if (cancelled) return;

      if (sectionsRes.error || subsectionsRes.error) {
        setError("Не удалось загрузить разделы");
        setSections([]);
        setLoading(false);
        return;
      }

      const subsectionsBySection = new Map<string, ThreadSubsection[]>();
      ((subsectionsRes.data ?? []) as ThreadSubsection[]).forEach((sub) => {
        const list = subsectionsBySection.get(sub.section_id) ?? [];
        list.push(sub);
        subsectionsBySection.set(sub.section_id, list);
      });

      const tree = ((sectionsRes.data ?? []) as ThreadSection[]).map((section) => ({
        ...section,
        subsections: subsectionsBySection.get(section.id) ?? [],
      }));

      setSections(tree);
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, enabled]);

  return { sections, loading, error, reload };
};
