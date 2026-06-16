import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MediaPlayer } from "./MediaPlayer";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

describe("MediaPlayer", () => {
  it("renders video element for kind=video", () => {
    render(
      <MediaPlayer
        kind="video"
        sources={[{ src: "test.mp4", type: "video/mp4" }]}
      />,
    );
    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.querySelector("source")?.getAttribute("src")).toBe("test.mp4");
  });

  it("renders audio element for kind=audio", () => {
    render(
      <MediaPlayer
        kind="audio"
        sources={[{ src: "test.mp3", type: "audio/mpeg" }]}
      />,
    );
    const audio = document.querySelector("audio");
    expect(audio).toBeInTheDocument();
    expect(audio?.querySelector("source")?.getAttribute("src")).toBe("test.mp3");
  });

  it("renders fallback text", () => {
    render(
      <MediaPlayer
        kind="video"
        sources={[{ src: "test.mp4" }]}
      />,
    );
    expect(screen.getByText("Ваш браузер не поддерживает воспроизведение.")).toBeInTheDocument();
  });

  it("applies className", () => {
    const { container } = render(
      <MediaPlayer
        kind="video"
        sources={[{ src: "test.mp4" }]}
        className="custom-player"
      />,
    );
    expect(container.querySelector(".custom-player")).toBeInTheDocument();
  });

  it("renders multiple sources", () => {
    render(
      <MediaPlayer
        kind="video"
        sources={[
          { src: "test.mp4", type: "video/mp4" },
          { src: "test.webm", type: "video/webm" },
        ]}
      />,
    );
    const video = document.querySelector("video");
    const sources = video?.querySelectorAll("source");
    expect(sources?.length).toBe(2);
  });

  it("sets poster attribute on video", () => {
    render(
      <MediaPlayer
        kind="video"
        sources={[{ src: "test.mp4" }]}
        poster="poster.jpg"
      />,
    );
    const video = document.querySelector("video");
    expect(video?.getAttribute("data-poster")).toBe("poster.jpg");
  });

  it("sets controls attribute", () => {
    render(
      <MediaPlayer
        kind="video"
        sources={[{ src: "test.mp4" }]}
      />,
    );
    const video = document.querySelector("video");
    expect(video?.hasAttribute("controls")).toBe(true);
  });
});
