import { describe, expect, it } from "vitest";

import { isYouTubeId, parseYouTubeId, youtubeEmbedUrl, youtubeThumbnailUrl } from "./youtubeSchema";

describe("parseYouTubeId", () => {
  it("parses common URL shapes and bare ids", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=1")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-video input", () => {
    expect(parseYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/")).toBeNull();
    expect(parseYouTubeId("short")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
  });

  it("builds privacy-friendly embed + thumbnail urls", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ")).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");
    expect(isYouTubeId("dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeId("bad")).toBe(false);
  });
});
