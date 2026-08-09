import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MessengerLightbox } from "./MessengerLightbox";
import type { Attachment } from "./types";

function makeAttachment(url: string, type: Attachment["type"] = "image"): Attachment {
  return {
    url,
    type,
    name: url,
    size: 1000,
    mime: type === "image" ? "image/jpeg" : "video/mp4",
    ...(type === "image" ? { meta: JSON.stringify({ width: 800, height: 600 }) } : {}),
  };
}

describe("MessengerLightbox", () => {
  const attachments = [makeAttachment("a.jpg"), makeAttachment("b.jpg"), makeAttachment("c.jpg")];

  it("renders a fullscreen dialog with counter and controls", () => {
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={vi.fn()} />);
    const dialog = document.body.querySelector(".msg-lightbox");
    expect(dialog).toBeInTheDocument();
    expect(document.body.querySelector(".msg-lightbox-counter")).toHaveTextContent("/ 3");
    expect(document.body.querySelector('[aria-label="Закрыть"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Скачать"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Сбросить масштаб"]')).toBeInTheDocument();
    expect(document.body.querySelectorAll(".msg-lightbox-slide")).toHaveLength(3);
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={onClose} />);
    fireEvent.click(document.body.querySelector('[aria-label="Закрыть"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via Escape", () => {
    const onClose = vi.fn();
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the stage outside slides and controls", () => {
    const onClose = vi.fn();
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking a slide", () => {
    const onClose = vi.fn();
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-slide")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the zoom reset disabled at scale 1", () => {
    render(<MessengerLightbox attachments={attachments} initialIndex={0} onClose={vi.fn()} />);
    const reset = document.body.querySelector('[aria-label="Сбросить масштаб"]') as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
  });
});
