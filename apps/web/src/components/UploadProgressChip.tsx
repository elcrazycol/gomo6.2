import { motion } from "framer-motion";
import { Check, FileAudio2, FileText, FileVideo2, Image as ImageIcon, X } from "lucide-react";

export interface UploadingFileLike {
  id: string;
  name: string;
  progress: number;
  type: string;
}

const iconFor = (type: string) => {
  switch (type) {
    case "image":
      return <ImageIcon className="w-4 h-4" />;
    case "video":
      return <FileVideo2 className="w-4 h-4" />;
    case "audio":
      return <FileAudio2 className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

/**
 * Shared uploading-file chip used by the thread/post/wall uploaders. Shows the
 * file icon, name, a smoothly animated progress bar fed by real XHR bytes, the
 * live percent (or a check at 100%) and a cancel button. Wrap in a motion.div
 * with `chipMotion` inside your AnimatePresence for enter/exit animations.
 */
export const UploadProgressChip = ({
  file,
  onCancel,
}: {
  file: UploadingFileLike;
  onCancel: (id: string) => void;
}) => (
  <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg border border-border/40">
    <div className="flex-shrink-0 w-8 h-8 rounded-md bg-background border border-border/60 flex items-center justify-center text-muted-foreground">
      {iconFor(file.type)}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium truncate">{file.name}</p>
      <div className="w-full bg-muted rounded-full h-1 mt-1.5 overflow-hidden">
        <motion.div
          className="bg-primary h-1 rounded-full"
          animate={{ width: `${file.progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
    <div className="flex-shrink-0 text-xs text-muted-foreground font-mono tabular-nums">
      {file.progress >= 100 ? <Check className="w-4 h-4 text-emerald-500" /> : `${file.progress}%`}
    </div>
    <button
      type="button"
      onClick={() => onCancel(file.id)}
      className="flex-shrink-0 p-1 hover:bg-muted rounded-md transition-colors"
      aria-label="Отменить загрузку"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);
