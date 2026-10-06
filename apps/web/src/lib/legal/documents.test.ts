import { describe, it, expect } from "vitest";

import { LEGAL_TOKENS, fillLegalText } from "./config";
import { LEGAL_DOCUMENTS, LEGAL_DOC_ORDER, type LegalDocId } from "./documents";

/** Все токены, встречающиеся в текстах документов ({{brand}}, {{contact}}, …). */
const collectTokens = (value: unknown): string[] => {
  const raw = JSON.stringify(value);
  return [...raw.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
};

describe("legal documents", () => {
  it("uses only known tokens — an unknown one would render as {{raw}}", () => {
    const used = new Set(collectTokens(LEGAL_DOCUMENTS));
    const unknown = [...used].filter((token) => !(token in LEGAL_TOKENS));
    expect(unknown).toEqual([]);
  });

  it("leaves no tokens behind after substitution", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      expect(fillLegalText(JSON.stringify(doc))).not.toContain("{{");
    }
  });

  it("lists every document exactly once and links only to existing ones", () => {
    expect([...LEGAL_DOC_ORDER].sort()).toEqual(Object.keys(LEGAL_DOCUMENTS).sort());

    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      for (const related of doc.related) {
        expect(LEGAL_DOC_ORDER).toContain(related);
      }
      expect(doc.related).not.toContain(doc.id);
    }
  });

  it("has unique, stable anchors inside each document", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/));
      expect(doc.sections.length).toBeGreaterThan(3);
    }
  });

  it("carries a version on every document so re-acceptance can be triggered", () => {
    for (const id of Object.keys(LEGAL_DOCUMENTS) as LegalDocId[]) {
      expect(LEGAL_DOCUMENTS[id].version).toMatch(/^\d+\.\d+/);
    }
  });
});
