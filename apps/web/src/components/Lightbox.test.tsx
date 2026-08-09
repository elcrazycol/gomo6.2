import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Lightbox, type LightboxItem } from "./Lightbox";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

function makeItem(url: string, type: LightboxItem["type"] = "image"): LightboxItem {
  return {
    url,
    type,
    name: url,
    size: 1000,
    mime: type === "image" ? "image/jpeg" : "video/mp4",
    ...(type === "image" ? { meta: JSON.stringify({ width: 800, height: 600 }) } : {}),
  };
}

describe("Lightbox", () => {
  const items = [makeItem("a.jpg"), makeItem("b.jpg"), makeItem("c.jpg")];

  it("renders a fullscreen dialog with counter and controls", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const dialog = document.body.querySelector(".msg-lightbox");
    expect(dialog).toBeInTheDocument();
    expect(document.body.querySelector(".msg-lightbox-counter")).toHaveTextContent("/ 3");
    expect(document.body.querySelector('[aria-label="Закрыть"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Скачать"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Сбросить масштаб"]')).toBeInTheDocument();
    expect(document.body.querySelectorAll(".msg-lightbox-slide")).toHaveLength(3);
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(3);
  });

  it("selects a photo from the thumbnail strip", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const thumbnails = document.body.querySelectorAll(".msg-lightbox-thumbnail");
    fireEvent.click(thumbnails[2]);
    expect(thumbnails[2]).toHaveAttribute("aria-current", "true");
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.click(document.body.querySelector('[aria-label="Закрыть"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via Escape", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the stage outside slides and controls", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking a slide", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-slide")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the zoom reset disabled at scale 1", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const reset = document.body.querySelector('[aria-label="Сбросить масштаб"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
  });

  it("does not show the edit button without onEditImage", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    expect(document.body.querySelector('[aria-label="Редактировать"]')).not.toBeInTheDocument();
  });

  it("opens the crop/epstein editor when onEditImage is provided", () => {
    const onEditImage = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} onEditImage={onEditImage} />);
    fireEvent.click(document.body.querySelector('[aria-label="Редактировать"]')!);
    expect(document.body.querySelector('[aria-label="Закрыть"]')).toBeInTheDocument();
    expect(document.body.textContent).toContain("Кадрировать");
    expect(document.body.textContent).toContain("Epstein");
  });

  it("renders video slides as a video element", () => {
    render(<Lightbox items={[makeItem("movie.mp4", "video")]} initialIndex={0} onClose={vi.fn()} />);
    expect(document.body.querySelector(".msg-lightbox-slide video")).toBeInTheDocument();
  });
});
