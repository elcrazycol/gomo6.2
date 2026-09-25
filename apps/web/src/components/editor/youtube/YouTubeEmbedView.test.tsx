import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YouTubeEmbedView } from "./YouTubeEmbedView";

describe("YouTubeEmbedView", () => {
  it("shows a facade and loads the nocookie iframe on click", () => {
    const { container } = render(<YouTubeEmbedView videoId="dQw4w9WgXcQ" />);

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");

    fireEvent.click(screen.getByRole("button", { name: /Воспроизвести/ }));

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("shows an unavailable state for an invalid id", () => {
    render(<YouTubeEmbedView videoId="bad" />);
    expect(screen.getByText("Видео недоступно")).toBeInTheDocument();
  });
});
