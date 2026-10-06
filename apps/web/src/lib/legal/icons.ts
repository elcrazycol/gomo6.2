import { Code2, Cookie, Copyright, Fingerprint, ScrollText, Scale, type LucideIcon } from "lucide-react";

import type { LegalDocId } from "./documents";

/**
 * Иконки документов — отдельным модулем, чтобы сами тексты (documents.ts)
 * оставались данными, а рендерер не экспортировал посторонние константы.
 */
export const LEGAL_DOC_ICONS: Record<LegalDocId, LucideIcon> = {
  terms: ScrollText,
  // Отпечаток вместо щита: щит читался как «безопасность», а документ — о том,
  // какие данные мы обрабатываем.
  privacy: Fingerprint,
  cookies: Cookie,
  rules: Scale,
  copyright: Copyright,
  developer: Code2,
};
