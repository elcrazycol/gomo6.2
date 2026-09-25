// In-flight upload tile. A transient atom block shown where the eventual media
// will land; it is replaced by a mediaBlock when the upload finishes and is
// stripped before the document is persisted.

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FileText, FileVideo2, Music, X } from "lucide-react";

import { SquareUploadProgress } from "@/components/SquareUploadProgress";
import type { AttachmentUploadPhase } from "@/utils/mediaUpload";

const KindIcon = ({ kind, className }: { kind: string; className?: string }) => {
  if (kind === "audio") return <Music className={className} />;
  if (kind === "video") return <FileVideo2 className={className} />;
  return <FileText className={className} />;
};

export const UploadPlaceholderNodeView = ({ node, deleteNode }: NodeViewProps) => {
  const { kind, name, percent, phase, error } = node.attrs as {
    kind: string;
    name: string;
    percent: number;
    phase: AttachmentUploadPhase;
    error: string | null;
  };

  return (
    <NodeViewWrapper
      as="div"
      data-upload-placeholder="true"
      contentEditable={false}
      className="relative my-1 mr-2 inline-block w-40 align-middle"
    >
      <div className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        {error ? (
          <span className="px-3 text-center text-xs text-destructive">{error}</span>
        ) : (
          <>
            {percent === 0 && <KindIcon kind={kind} className="h-8 w-8 text-muted-foreground/70" />}
            <SquareUploadProgress percent={percent} phase={phase} />
          </>
        )}

        <button
          type="button"
          onClick={deleteNode}
          aria-label="Убрать загрузку"
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition active:scale-90"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {name && <div className="mt-1 truncate text-center text-xs text-muted-foreground">{name}</div>}
    </NodeViewWrapper>
  );
};
