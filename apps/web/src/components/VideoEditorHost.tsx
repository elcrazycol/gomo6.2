import { lazy, Suspense, useEffect, useState } from "react";
import { useVideoEditorStore } from "@/stores/videoEditorStore";

// Lazy: the editor is only pulled in when a video is actually picked, so it
// never weighs on the initial bundle.
const VideoEditor = lazy(() => import("@/components/VideoEditor"));

/**
 * Single mount point for the video editor. Rendered once at the app root; any
 * code path can trigger it via `openVideoEditor(file)` without prop drilling.
 */
export function VideoEditorHost() {
  const pending = useVideoEditorStore((s) => s.pending);
  const finish = useVideoEditorStore((s) => s.finish);
  const setHostReady = useVideoEditorStore((s) => s.setHostReady);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setHostReady(true);
    return () => setHostReady(false);
  }, [setHostReady]);

  useEffect(() => {
    if (!pending) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(pending.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  if (!pending || !src) return null;

  return (
    <Suspense fallback={null}>
      <VideoEditor
        src={src}
        fileName={pending.file.name}
        mode={pending.mode}
        onApply={finish}
        onCancel={() => finish(null)}
      />
    </Suspense>
  );
}

export default VideoEditorHost;
