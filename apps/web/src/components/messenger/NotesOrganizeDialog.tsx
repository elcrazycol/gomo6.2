import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder, Pin, Tag, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useMessengerStore } from "@/stores/messengerStore";
import type { NotesMeta } from "@/utils/notesCrypto";
import type { MessageView } from "./types";

interface Props {
  /** The note being organized (null hides the dialog). */
  message: MessageView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Organize dialog for a single note: pin toggle, folder assignment and tags.
 * Everything is saved as client-side E2E-encrypted metadata — the server
 * stores an opaque blob and cannot read folder names, tags or pin state.
 */
export function NotesOrganizeDialog({ message, open, onOpenChange }: Props) {
  const messages = useMessengerStore((s) => s.messages);
  const setNotesMeta = useMessengerStore((s) => s.setNotesMeta);

  const [pinned, setPinned] = useState(false);
  const [folder, setFolder] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Suggestions from every loaded note (decrypted locally).
  const known = useMemo(() => {
    const folders = new Set<string>();
    const tags = new Set<string>();
    for (const m of messages) {
      if (m.notesFolder) folders.add(m.notesFolder);
      for (const tag of m.notesTags ?? []) tags.add(tag);
    }
    return {
      folders: [...folders].sort((a, b) => a.localeCompare(b, "ru")),
      tags: [...tags].sort((a, b) => a.localeCompare(b, "ru")),
    };
  }, [messages]);

  useEffect(() => {
    if (!open || !message) return;
    setPinned(Boolean(message.notesPinned));
    setFolder(message.notesFolder ?? "");
    setTagsInput((message.notesTags ?? []).join(", "));
  }, [open, message]);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setTagsInput((current) => {
      const existing = current.split(",").map((t) => t.trim()).filter(Boolean);
      if (existing.includes(trimmed)) return current;
      return [...existing, trimmed].join(", ");
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!message || saving) return;
    setSaving(true);
    const meta: NotesMeta = {
      pinned,
      folder: folder.trim() || null,
      tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      await setNotesMeta(message.id, meta);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [message, saving, pinned, folder, tagsInput, setNotesMeta, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="notes-organize-dialog max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder size={16} className="notes-lock-badge-icon" />
            Организация заметки
          </DialogTitle>
          <DialogDescription>
            Закрепи важную заметку, положи её в папку или добавь теги. Папки и теги
            шифруются на устройстве так же, как текст заметки.
          </DialogDescription>
        </DialogHeader>

        <div className="notes-organize-body">
          <div className="notes-organize-row">
            <div className="notes-organize-row-copy">
              <div className="notes-organize-label"><Pin size={14} /> Закрепить</div>
              <div className="notes-organize-hint">Заметка будет всегда показываться вверху</div>
            </div>
            <Switch checked={pinned} onCheckedChange={setPinned} aria-label="Закрепить заметку" />
          </div>

          <div className="notes-organize-field">
            <label className="notes-organize-label" htmlFor="notes-folder-input">
              <Folder size={14} /> Папка
            </label>
            <div className="notes-organize-input-wrap">
              <input
                id="notes-folder-input"
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Название папки (напр. «Идеи»)"
                list="notes-folder-suggestions"
                maxLength={60}
                autoComplete="off"
              />
              {folder.trim() && (
                <button
                  type="button"
                  className="notes-clear-field"
                  onClick={() => setFolder("")}
                  aria-label="Убрать папку"
                  title="Без папки"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <datalist id="notes-folder-suggestions">
              {known.folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>

          <div className="notes-organize-field">
            <label className="notes-organize-label" htmlFor="notes-tags-input">
              <Tag size={14} /> Теги
            </label>
            <div className="notes-organize-input-wrap">
              <input
                id="notes-tags-input"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="через запятую: идея, важно, работа"
                maxLength={400}
                autoComplete="off"
              />
            </div>
            {known.tags.length > 0 && (
              <div className="notes-tag-suggestions">
                {known.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="notes-tag-suggestion"
                    onClick={() => addTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="notes-organize-footer">
            <button type="button" className="notes-organize-cancel" onClick={() => onOpenChange(false)}>
              Отмена
            </button>
            <button type="button" className="notes-organize-save" onClick={handleSave} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
