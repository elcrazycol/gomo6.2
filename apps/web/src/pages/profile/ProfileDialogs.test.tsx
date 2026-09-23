import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { AvatarGalleryDialog } from "./ProfileDialogs";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

// Deterministic embla stub: one slide is always selected; navigation is driven
// through the thumbnail buttons, matching Lightbox.test.tsx.
vi.mock("embla-carousel-react", () => {
  type EmblaApi = {
    on: (event: string, cb: () => void) => EmblaApi;
    off: (event: string, cb: () => void) => EmblaApi;
    scrollTo: (index: number) => EmblaApi;
    selectedScrollSnap: () => number;
  };
  return {
    __esModule: true,
    default: () => {
      let currentIndex = 0;
      const listeners: Record<string, Array<() => void>> = {};
      const api: EmblaApi = {
        on(event, cb) {
          (listeners[event] ??= []).push(cb);
          return api;
        },
        off(event, cb) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb);
          return api;
        },
        scrollTo(index) {
          currentIndex = index;
          (listeners.select ?? []).forEach((cb) => cb());
          return api;
        },
        selectedScrollSnap() {
          return currentIndex;
        },
      };
      return [() => {}, api];
    },
  };
});

const avatars = [
  { id: "a1", avatar_url: "u/1.png", is_current: true },
  { id: "a2", avatar_url: "u/2.png", is_current: false },
  { id: "a3", avatar_url: "u/3.png", is_current: false },
];

function query(selector: string): HTMLElement {
  const el = document.body.querySelector(selector);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("AvatarGalleryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the shared lightbox carousel over the avatar history", () => {
    render(
      <AvatarGalleryDialog
        avatars={avatars}
        initialIndex={0}
        canDelete={false}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(query(".msg-lightbox")).toBeInTheDocument();
    expect(query(".msg-lightbox-counter")).toHaveTextContent("1 / 3");
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(3);
  });

  it("hides the delete action for a non-owner", () => {
    render(
      <AvatarGalleryDialog
        avatars={avatars}
        initialIndex={0}
        canDelete={false}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(document.body.querySelector('[aria-label="Удалить аватар"]')).not.toBeInTheDocument();
  });

  it("confirms deletion and removes the currently viewed avatar", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <AvatarGalleryDialog
        avatars={avatars}
        initialIndex={0}
        canDelete
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    // Move to the second slide, then ask to delete it.
    fireEvent.click(document.body.querySelector(".msg-lightbox-thumbnail:nth-child(2)")!);
    fireEvent.click(document.body.querySelector('[aria-label="Удалить аватар"]')!);

    // The confirmation sits on top of the viewer and explains the consequence.
    expect(await screen.findByText("Удалить аватар?")).toBeInTheDocument();
    expect(screen.getByText("Это действие нельзя отменить. Аватар будет удален из истории.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a2"));
  });

  it("closes the viewer when the last avatar is removed", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <AvatarGalleryDialog
        avatars={[avatars[0]]}
        initialIndex={0}
        canDelete
        onClose={onClose}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(document.body.querySelector('[aria-label="Удалить аватар"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
