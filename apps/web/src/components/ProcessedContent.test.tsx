import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcessedContent } from "./ProcessedContent";

const mockFrom = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock("@/utils/contentVisibility", () => ({
  processVisibilityTags: vi.fn(async (content: string) => ({
    processedContent: content,
    isHidden: false,
    hasHiddenParts: false,
  })),
  VisibilityResult: {},
}));

vi.mock("@/utils/bbcodePlugins", () => ({
  renderBbCode: (text: string) => text,
}));

vi.mock("@/components/MentionLink", () => ({
  MentionLink: ({ username }: any) => <span data-testid="mention-link">@{username}</span>,
}));

vi.mock("@/components/RichContentRenderer", () => ({
  RichContentRenderer: ({ contentJson }: any) => (
    <span data-testid="rich-content">Rich: {JSON.stringify(contentJson)}</span>
  ),
}));

vi.mock("@/hooks/useUserColor", () => ({
  useUserColor: () => ({ data: "" }),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

describe("ProcessedContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      const p = Promise.resolve({ data: null, error: null }) as any;
      p.select = () => p;
      p.eq = () => p;
      p.single = () => p;
      p.in = () => p;
      return p;
    });
  });

  it("renders simple text content", async () => {
    render(
      <ProcessedContent
        content="Hello world"
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    const { container } = render(
      <ProcessedContent
        content="Hello"
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );
    expect(screen.getByText("Загрузка...")).toBeInTheDocument();
  });

  it("renders contentJson with RichContentRenderer when provided and not legacy", async () => {
    const contentJson = { type: "root", children: [] };
    render(
      <ProcessedContent
        content="test"
        contentJson={contentJson}
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("rich-content")).toBeInTheDocument();
    });
  });

  it("renders empty content without errors", async () => {
    render(
      <ProcessedContent
        content=""
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("Загрузка...")).not.toBeInTheDocument();
    });
  });

  it("renders content with BB code markers", async () => {
    render(
      <ProcessedContent
        content="[b]bold text[/b]"
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("[b]bold text[/b]")).toBeInTheDocument();
    });
  });

  it("renders dude link marker", async () => {
    const { processVisibilityTags } = await import("@/utils/contentVisibility");
    (processVisibilityTags as any).mockResolvedValueOnce({
      processedContent: "__DUDE_LINK__ said hi",
      isHidden: false,
      hasHiddenParts: false,
    });

    render(
      <ProcessedContent
        content="test"
        currentUserId="u1"
        isAdmin={false}
        currentUsername="testuser"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
  });
});
