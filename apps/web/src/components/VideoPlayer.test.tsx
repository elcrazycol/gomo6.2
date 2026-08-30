import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
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
  const pause = vi.fn(function (this: HTMLMediaElement) {
    this.dataset._paused = "true";
    this.dispatchEvent(new Event("pause"));
  });
  HTMLMediaElement.prototype.pause = pause;
  return { play: HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>, pause };
};

// jsdom has no matchMedia; emulate (hover: hover)/(hover: none).
const mockHoverDevice = (hover: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("hover: hover") ? hover : !hover,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

/** The bottom gradient controls bar. */
const controlsBar = (container: HTMLElement) =>
  document.querySelector<HTMLElement>(".bg-gradient-to-t");

describe("VideoPlayer", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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
    const { pause } = mediaPlayPause();
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

  it("auto-hides controls while playing then shows them on hover", () => {
    vi.useFakeTimers();
    mediaPlayPause();
    mockHoverDevice(true);
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const bar = controlsBar(container)!;
    // Not playing yet: controls are visible.
    expect(bar.className).not.toContain("opacity-0");

    const btns = screen.getAllByRole("button", { name: "Воспроизвести" });
    fireEvent.click(btns[0]);
    // Immediately after play starts, controls remain visible.
    expect(bar.className).not.toContain("opacity-0");

    // After the idle delay they fade away.
    act(() => vi.advanceTimersByTime(3000));
    expect(bar.className).toContain("opacity-0");
    expect(container.querySelector(".cursor-none")).not.toBeNull();

    // Moving the pointer over the player brings them back and re-arms hide.
    fireEvent.pointerMove(container.querySelector("video")!);
    expect(bar.className).not.toContain("opacity-0");
    expect(container.querySelector(".cursor-none")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps controls visible while paused", () => {
    vi.useFakeTimers();
    mediaPlayPause();
    // Play then pause: once paused, controls must stay even after idle.
    mockHoverDevice(true);
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const bar = controlsBar(container)!;
    const playBtns = screen.getAllByRole("button", { name: "Воспроизвести" });
    fireEvent.click(playBtns[0]);
    // While playing the bottom-bar action becomes a pause button.
    fireEvent.click(screen.getByRole("button", { name: "Поставить на паузу" }));
    act(() => vi.advanceTimersByTime(3000));
    expect(bar.className).not.toContain("opacity-0");
    vi.useRealTimers();
  });

  it("does not auto-hide controls on a touch (hover:none) device", () => {
    vi.useFakeTimers();
    mediaPlayPause();
    mockHoverDevice(false);
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} />);
    const bar = controlsBar(container)!;
    const btns = screen.getAllByRole("button", { name: "Воспроизвести" });
    fireEvent.click(btns[0]);
    act(() => vi.advanceTimersByTime(3000));
    expect(bar.className).not.toContain("opacity-0");
    expect(container.querySelector(".cursor-none")).toBeNull();
    vi.useRealTimers();
  });

  it("open-mode: clicking the thumb calls onOpen and never plays inline", () => {
    mediaPlayPause();
    const onOpen = vi.fn();
    const { container } = render(
      <VideoPlayer sources={[{ src: "clip.mp4" }]} onOpen={onOpen} />
    );
    const video = container.querySelector("video")!;
    fireEvent.click(video);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(video.dataset._paused).not.toBe("false"); // never started
    // Inline play controls are suppressed (faded out) in open mode.
    const bar = controlsBar(container)!;
    expect(bar.className).toContain("opacity-0");
    expect(bar.className).toContain("pointer-events-none");
  });

  it("open-mode: centre button opens instead of playing", () => {
    mediaPlayPause();
    const onOpen = vi.fn();
    render(<VideoPlayer sources={[{ src: "clip.mp4" }]} onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: "Открыть пост" });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("autoplay: plays the clip once it can play", () => {
    const { play } = mediaPlayPause();
    mockHoverDevice(true);
    const { container } = render(<VideoPlayer sources={[{ src: "clip.mp4" }]} autoPlay />);
    const video = container.querySelector("video")!;
    // readyState < 2 initially → waits for canplay.
    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    video.dispatchEvent(new Event("canplay"));
    expect(play).toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(video.defaultMuted).toBe(false);
    expect(video.dataset._paused).toBe("false");
  });
});