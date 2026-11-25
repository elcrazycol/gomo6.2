import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { messengerPlainPreview } from "./messengerRichTextUtils";
import type { MessageView } from "./types";

interface Props {
  notes: MessageView[];
  onJump: (messageId: string) => void;
}

/**
 * Telegram's pinned-message bar, for the notes self-chat.
 *
 * One compact row — icon, preview of the CURRENTLY selected pinned note, a
 * position counter and a chevron. A tap jumps to the next pinned note (wrapping
 * around, so the bar is a cycle through the pins); the chevron opens the short
 * list. The old implementation rendered every pinned note as a full message in
 * a dedicated section that could eat 38% of the viewport before the chat even
 * started.
 */
export function NotesPinnedBanner({ notes, onJump }: Props) {
  const [index, setIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);

  // A deleted note has no preview to show and nothing to jump to: it must not
  // appear in the bar at all (the store already drops deleted ids, this keeps a
  // stale prop from leaking a «Удалено» row).
  const pins = useMemo(() => notes.filter((note) => !note.is_deleted), [notes]);

  // Pins can be added/removed while the bar is visible: keep the cursor in
  // range instead of pointing at a note that no longer exists.
  useEffect(() => {
    if (index >= pins.length) setIndex(0);
  }, [pins.length, index]);

  const current = pins[index] ?? pins[0] ?? null;
  const preview = useMemo(
    () => (current ? messengerPlainPreview(current.content, 120) : ""),
    [current],
  );

  if (!current) return null;

  const jumpTo = (target: number) => {
    const note = pins[target];
    if (!note) return;
    setIndex(target);
    setListOpen(false);
    onJump(note.id);
  };

  return (
    <div className="notes-pinned-banner">
      <button
        type="button"
        className="notes-pinned-main"
        onClick={() => jumpTo((index + 1) % pins.length)}
        title="Перейти к закреплённой заметке"
      >
        <span className="notes-pinned-icon"><Pin size={12} /></span>
        <span className="notes-pinned-copy">
          <span className="notes-pinned-label">Закреплённые заметки</span>
          <span className="notes-pinned-text">{preview}</span>
        </span>
        <span className="notes-pinned-count">
          {index + 1}/{pins.length}
        </span>
      </button>

      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`notes-pinned-expand${listOpen ? " is-open" : ""}`}
            aria-label="Все закреплённые заметки"
            title="Все закреплённые"
          >
            <ChevronDown size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="notes-pinned-popover w-80 p-1">
          <div className="notes-pinned-popover-head">Закреплённые · {pins.length}</div>
          <div className="notes-pinned-popover-list">
            {pins.map((note, noteIndex) => (
              <button
                key={note.id}
                type="button"
                className={`notes-pinned-popover-item${noteIndex === index ? " is-current" : ""}`}
                onClick={() => jumpTo(noteIndex)}
              >
                <Pin size={11} />
                <span>{messengerPlainPreview(note.content, 90)}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
