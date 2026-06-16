import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

const mockApplyTheme = vi.fn();
const mockGetStoredTheme = vi.fn(() => ({ colorTheme: "cannabis", isDarkMode: true }));
const mockSyncSharedAppearanceCookies = vi.fn();

vi.mock("@/utils/theme", () => ({
  applyTheme: (...args: any[]) => mockApplyTheme(...args),
  getStoredTheme: () => mockGetStoredTheme(),
  syncSharedAppearanceCookies: (...args: any[]) => mockSyncSharedAppearanceCookies(...args),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (
    <div data-testid="dialog" data-open={String(open)}>
      {children}
    </div>
  ),
  DialogContent: ({ children, className }: any) => <div className={className} data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/radio-group", () => {
  let currentOnValueChange: ((val: string) => void) | null = null;
  return {
    RadioGroup: ({ children, value, onValueChange }: any) => {
      currentOnValueChange = onValueChange;
      return (
        <div data-testid="radio-group" data-value={value}>
          {children}
        </div>
      );
    },
    RadioGroupItem: ({ value, id }: any) => (
      <input
        type="radio"
        value={value}
        id={id}
        onChange={() => currentOnValueChange?.(value)}
      />
    ),
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ id, checked, onCheckedChange }: any) => (
    <button
      data-testid={id}
      onClick={() => onCheckedChange(!checked)}
    >
      {checked ? "on" : "off"}
    </button>
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, className }: any) => (
    <label htmlFor={htmlFor} className={className}>{children}</label>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, ...props }: any) => (
    <button onClick={onClick} data-variant={variant} {...props}>{children}</button>
  ),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoredTheme.mockReturnValue({ colorTheme: "cannabis", isDarkMode: true });
  });

  it("renders settings button with sr-only label", () => {
    render(<ThemeToggle />);
    expect(screen.getByText("Настройки темы", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("opens dialog and shows theme title", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    expect(screen.getByTestId("dialog-title")).toHaveTextContent("Настройки темы");
  });

  it("shows color theme options", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    expect(screen.getByText(/Зелёная каннабиоидная/)).toBeInTheDocument();
    expect(screen.getByText(/Розовая няшная/)).toBeInTheDocument();
  });

  it("shows all color schemes", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    const schemes = [
      "Зелёная каннабиоидная", "Розовая няшная", "Синяя депрессивная",
      "Кроваво-красная", "Оранжево-тыквенная", "Монохромный графит",
      "Космический лавандовый", "Вулканический пепел", "Мятный лимонад",
      "Глитч-кор", "Кислотный шторм", "Пустота",
    ];
    for (const scheme of schemes) {
      expect(screen.getByText(new RegExp(scheme))).toBeInTheDocument();
    }
  });

  it("calls applyTheme when color changes", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    await user.click(screen.getByDisplayValue("cannabis"));

    expect(mockApplyTheme).toHaveBeenCalled();
  });

  it("toggles dark mode", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    await user.click(screen.getByTestId("dark-mode"));

    expect(mockApplyTheme).toHaveBeenCalled();
  });

  it("syncs cookies after color theme change", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    await user.click(screen.getByDisplayValue("pink"));

    expect(mockSyncSharedAppearanceCookies).toHaveBeenCalled();
  });

  it("syncs cookies after dark mode toggle", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    await user.click(screen.getByTestId("dark-mode"));

    expect(mockSyncSharedAppearanceCookies).toHaveBeenCalled();
  });

  it("loads theme from localStorage on mount", () => {
    render(<ThemeToggle />);
    expect(mockGetStoredTheme).toHaveBeenCalled();
  });

  it("displays dark mode switch state", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    expect(screen.getByTestId("dark-mode")).toHaveTextContent("on");
  });

  it("shows Цветовая схема label", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    expect(screen.getByText("Цветовая схема")).toBeInTheDocument();
  });

  it("shows Тёмный режим label", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /Настройки темы/i }));
    expect(screen.getByText("Тёмный режим")).toBeInTheDocument();
  });
});
