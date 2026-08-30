import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

// jsdom has no real media playback; stub the play/pause API so handlers fire.
const mediaPlayPause = () => {
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return (this as HTMLMediaElement).dataset._paused !== "false";
    },
  });
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    this.dataset._paused = "false";
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    this.dataset._paused = "true";
    this.dispatchEvent(new Event("pause"));
  });
  return HTMLMediaElement.prototype.pause;
};

describe("VideoPlayer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a <video> with the given source", () => {
    render(<VideoPlayer sources={[{ src: "clip.mp4", type: "video/mp4" }]} />);
    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.querySelector("source")?.getAttribute("src")).toBe("clip.mp4");
  });

  it("renders a blurred poster backdrop with a dim layer", () => {
    render(<VideoPlayer sources={[{ src: "clip.mp4" }]} poster="poster.jpg" />);
    const backdrop = document.querySelector('img[src="poster.jpg"]');
    expect(backdrop?.className).toContain("blur-2xl");
    expect(document.querySelector(".bg-black\\/30")).not.toBeNull();
  });

  it("caps and centers the inline video like wall photos", () => {
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const video = container.querySelector("video");
    expect(video?.className).toContain("max-h-[70vh]");
    expect(video?.className).toContain("mx-auto");
    expect(video?.className).toContain("max-w-full");
  });

  it("renders no native controls", () => {
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const video = container.querySelector("video");
    expect(video?.hasAttribute("controls")).toBe(false);
  });

  it("plays when the center button is clicked", () => {
    mediaPlayPause();
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    // Both the center overlay and the bottom bar carry a play label; the center
    // one renders first.
    const btns = screen.getAllByRole("button", { name: "Воспроизвести" });
    const btn = btns[0];
    fireEvent.click(btn);
    const video = container.querySelector("video");
    expect(video?.dataset._paused).toBe("false");
  });

  it("does not auto-pause ~200ms after starting via the centre play button", () => {
    vi.useFakeTimers();
    const pause = mediaPlayPause();
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const btns = screen.getAllByRole("button", { name: "Воспроизвести" });
    fireEvent.click(btns[0]);
    const video = container.querySelector("video")!;
    expect(video.dataset._paused).toBe("false");
    // The container's delayed click-toggle must NOT fire for this button.
    vi.advanceTimersByTime(500);
    expect(video.dataset._paused).toBe("false");
    expect(pause).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("requests full screen via the Fullscreen API", () => {
    // jsdom lacks these APIs, but the component guards with optional chaining.
    const requestFF = vi.fn().mockResolvedValue(undefined);
    const exitFF = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFF;
    document.exitFullscreen = exitFF;
    render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    // Clicking the bottom-bar play button is intercepted by its label; use the
    // fullscreen control which also carries its own label.
    const fsBtn = screen.getByRole("button", { name: "На весь экран" });
    fireEvent.click(fsBtn);
    expect(requestFF).toHaveBeenCalled();
  });

  it("shows an error message when playback fails", () => {
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const video = container.querySelector("video");
    fireEvent.error(video!);
    expect(screen.getByText("Не удалось воспроизвести видео")).toBeInTheDocument();
  });
});