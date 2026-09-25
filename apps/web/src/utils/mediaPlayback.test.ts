import { afterEach, describe, expect, it, vi } from "vitest";

import { pauseAllInlineMedia } from "./mediaPlayback";

describe("pauseAllInlineMedia", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("pauses the video player and audio elements", () => {
    const video = document.createElement("video");
    video.setAttribute("data-video-player", "true");
    const audio = document.createElement("audio");
    const pauseVideo = vi.fn();
    const pauseAudio = vi.fn();
    video.pause = pauseVideo;
    audio.pause = pauseAudio;
    document.body.append(video, audio);

    pauseAllInlineMedia();

    expect(pauseVideo).toHaveBeenCalledTimes(1);
    expect(pauseAudio).toHaveBeenCalledTimes(1);
  });

  it("leaves animated clips and avatars alone", () => {
    const animated = document.createElement("video");
    animated.className = "animated-video-el";
    const pauseAnimated = vi.fn();
    animated.pause = pauseAnimated;
    document.body.append(animated);

    pauseAllInlineMedia();

    expect(pauseAnimated).not.toHaveBeenCalled();
  });

  it("never throws when an element cannot be paused", () => {
    const video = document.createElement("video");
    video.setAttribute("data-video-player", "true");
    video.pause = () => {
      throw new Error("boom");
    };
    document.body.append(video);

    expect(() => pauseAllInlineMedia()).not.toThrow();
  });
});
