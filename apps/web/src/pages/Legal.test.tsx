import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, beforeEach, vi } from "vitest";

import Legal from "./Legal";
import { BRAND } from "@/lib/legal/config";
import { LEGAL_DOCUMENTS, LEGAL_DOC_ORDER } from "@/lib/legal/documents";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/legal" element={<Legal />} />
        <Route path="/legal/:docId" element={<Legal />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Legal pages", () => {
  beforeEach(() => {
    // jsdom has no layout engine: scrollTo/scrollIntoView are "not implemented".
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("lists every document on /legal", () => {
    renderAt("/legal");

    expect(screen.getByText("Правовая информация")).toBeInTheDocument();
    LEGAL_DOC_ORDER.forEach((id) => {
      expect(screen.getByText(LEGAL_DOCUMENTS[id].title)).toBeInTheDocument();
    });
  });

  it("renders a document with its sections", () => {
    renderAt("/legal/terms");

    expect(screen.getByText(LEGAL_DOCUMENTS.terms.title)).toBeInTheDocument();
    // Первая секция есть и в тексте, и в оглавлении.
    expect(screen.getAllByText(LEGAL_DOCUMENTS.terms.sections[0].title).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Содержание").length).toBeGreaterThan(0);
  });

  it("substitutes brand tokens — renaming the project needs no text edits", () => {
    // И список, и сам документ: ни одного незаполненного токена.
    const { container: index } = renderAt("/legal");
    expect(index.textContent).not.toContain("{{");

    const { container } = renderAt("/legal/terms");
    expect(container.textContent).not.toContain("{{");
    expect(container.textContent).toContain(BRAND.name);
  });

  it("falls back to the index for an unknown document", () => {
    renderAt("/legal/nope");

    expect(screen.getByText(/Такого документа нет/)).toBeInTheDocument();
    expect(screen.getByText("Правовая информация")).toBeInTheDocument();
  });
});
