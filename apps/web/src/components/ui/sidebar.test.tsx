import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarInset,
  useSidebar,
} from "./sidebar";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mobileMode = false;

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileMode,
}));

// Sheet uses Radix Dialog which renders into a portal — jsdom supports it with
// the setup polyfills, so no extra mocking needed.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetCookies() {
  document.cookie.split(";").forEach((c) => {
    document.cookie = c
      .replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date(0).toUTCString() + ";path=/");
  });
}

function renderSidebar(props: React.ComponentProps<typeof SidebarProvider> = {}) {
  return render(
    <SidebarProvider {...props}>
      <Sidebar>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>Home</SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton>Settings</SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

beforeEach(() => {
  mobileMode = false;
  resetCookies();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── SidebarProvider ─────────────────────────────────────────────────────────

describe("SidebarProvider", () => {
  it("renders children and defaults to expanded", () => {
    renderSidebar();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(document.querySelector('[data-state="expanded"]')).not.toBeNull();
  });

  it("honors defaultOpen={false}", () => {
    renderSidebar({ defaultOpen: false });
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });

  it("exposes context state via useSidebar", () => {
    let captured: any = null;
    function Probe() {
      captured = useSidebar();
      return null;
    }
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    );
    expect(captured).toMatchObject({
      state: "expanded",
      open: true,
      isMobile: false,
      openMobile: false,
    });
    expect(typeof captured.setOpen).toBe("function");
    expect(typeof captured.toggleSidebar).toBe("function");
  });

  it("throws when useSidebar is used outside the provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom() {
      useSidebar();
      return null;
    }
    expect(() => render(<Boom />)).toThrow(
      "useSidebar must be used within a SidebarProvider."
    );
    consoleSpy.mockRestore();
  });

  it("toggles via the trigger and persists the cookie", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>nav</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
    expect(document.cookie).toContain("sidebar:state=false");
  });

  it("re-opens when the trigger is clicked again", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>nav</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const trigger = screen.getByRole("button", { name: /toggle sidebar/i });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(document.querySelector('[data-state="expanded"]')).not.toBeNull();
  });

  it("toggles via Cmd/Ctrl+B keyboard shortcut", () => {
    renderSidebar();

    fireEvent.keyDown(window, { key: "b", metaKey: true });

    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });

  it("does not toggle on plain 'b' without modifier", () => {
    renderSidebar();

    fireEvent.keyDown(window, { key: "b" });

    expect(document.querySelector('[data-state="expanded"]')).not.toBeNull();
  });

  it("supports controlled open + onOpenChange", () => {
    const onOpenChange = vi.fn();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <Sidebar>
          <SidebarContent>nav</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

// ─── SidebarRail ─────────────────────────────────────────────────────────────

describe("SidebarRail", () => {
  it("toggles the sidebar on click", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>nav</SidebarContent>
        </Sidebar>
        <SidebarRail />
      </SidebarProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });
});

// ─── SidebarInset ────────────────────────────────────────────────────────────

describe("SidebarInset", () => {
  it("renders main content", () => {
    render(
      <SidebarProvider>
        <SidebarInset>Content area</SidebarInset>
      </SidebarProvider>
    );
    expect(screen.getByText("Content area")).toBeInTheDocument();
  });
});

// ─── Mobile behavior ─────────────────────────────────────────────────────────

describe("mobile sidebar", () => {
  it("renders a Sheet on mobile and opens it via the trigger", async () => {
    mobileMode = true;
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Mobile Nav</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );

    // Desktop sidebar content is not rendered on mobile
    expect(screen.queryByText("Mobile Nav")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    await waitFor(() => {
      expect(screen.getByText("Mobile Nav")).toBeInTheDocument();
    });
  });

  it("uses openMobile state from the provider", () => {
    mobileMode = true;
    let captured: any = null;
    function Probe() {
      captured = useSidebar();
      return null;
    }
    render(
      <SidebarProvider>
        <Probe />
        <Sidebar />
      </SidebarProvider>
    );
    expect(captured.isMobile).toBe(true);
    expect(captured.openMobile).toBe(false);
  });
});
