import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { exportNotesKey, hasNotesKey, importNotesKey, NOTES_LOCKED, notesKeyFingerprint } from "@/utils/notesCrypto";
import { useMessengerStore } from "@/stores/messengerStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active notes conversation id — messages are reloaded after key restore. */
  conversationId?: string;
}

export function NotesSettingsDialog({ open, onOpenChange, conversationId }: Props) {
  const [hasKey, setHasKey] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarn, setImportWarn] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setImportError(null);
    setImportWarn(null);
    setRestored(false);
    setImportValue("");
    setHasKey(hasNotesKey());
    void notesKeyFingerprint().then(setFingerprint);
    setExportedKey(null);
  }, [open]);

  const refreshKeyState = useCallback(async () => {
    setHasKey(hasNotesKey());
    void notesKeyFingerprint().then(setFingerprint);
    setExportedKey(null);
  }, []);

  const handleExport = useCallback(async () => {
    // Use a local variable — setExportedKey is async state, so re-reading
    // exportedKey here would be stale on the first click.
    const key = exportedKey ?? (await exportNotesKey());
    if (!key) return;
    setExportedKey(key);
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      // The key is also displayed below for manual copy.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [exportedKey]);

  const handleImport = useCallback(async () => {
    if (!importValue.trim()) return;
    const ok = await importNotesKey(importValue);
    if (!ok) {
      setImportError("Неверный ключ — нужна строка из 64 hex-символов (32 байта).");
      return;
    }
    setImportError(null);
    setImportWarn(null);
    setImportValue("");
    setRestored(true);
    await refreshKeyState();
    // Reload messages + previews so the restored key takes effect immediately.
    const store = useMessengerStore.getState();
    if (conversationId) {
      try {
        await store.loadMessages(conversationId);
      } catch {
        // The error banner in the chat covers network failures.
      }
    }
    void store.loadConversations();
    // Honest feedback: notes written with a previous device key stay locked.
    const locked = useMessengerStore
      .getState()
      .messages.filter((m) => m.content === NOTES_LOCKED).length;
    setImportWarn(
      locked > 0
        ? `Некоторые заметки (${locked}) остались зашифрованными — они были записаны другим ключом (на этом или другом устройстве), и восстановленный ключ их не открывает. Новые заметки будут шифроваться восстановленным ключом.`
        : null,
    );
    window.setTimeout(() => setRestored(false), 3000);
  }, [importValue, refreshKeyState, conversationId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="notes-settings-dialog max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={16} className="notes-lock-badge-icon" />
            Заметки · Безопасность
          </DialogTitle>
          <DialogDescription>
            Чат «Заметки» шифруется end-to-end на твоём устройстве. Ключ AES-256-GCM
            хранится только здесь и никогда не отправляется на сервер — сервер хранит
            лишь зашифрованный текст и не может прочитать ни одной заметки.
          </DialogDescription>
        </DialogHeader>

        <div className="notes-settings-body">
          <div className="notes-settings-status">
            <div className={`notes-settings-status-icon${hasKey ? " is-active" : ""}`}>
              <ShieldCheck size={18} />
            </div>
            <div className="notes-settings-status-copy">
              <div className="notes-settings-status-title">
                {hasKey ? "Ключ шифрования активен" : "Ключ шифрования не найден"}
              </div>
              <div className="notes-settings-status-sub">
                {hasKey
                  ? fingerprint
                    ? <>Отпечаток ключа: <code className="notes-key-fingerprint">{fingerprint}</code></>
                    : "Отпечаток недоступен"
                  : "Восстанови ключ из резервной копии, чтобы прочитать свои заметки на этом устройстве."}
              </div>
            </div>
          </div>

          <div className="notes-settings-section">
            <div className="notes-settings-section-title">Резервная копия ключа</div>
            <p className="notes-settings-section-text">
              Скопируй ключ и храни его в надёжном месте. Если очистишь данные сайта
              или потеряешь устройство без резервной копии, заметки станут нечитаемыми
              навсегда — это цена настоящего шифрования.
            </p>
            <button
              type="button"
              className={`notes-settings-action${copied ? " is-done" : ""}`}
              onClick={handleExport}
              disabled={!hasKey && !exportedKey}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Скопировано" : exportedKey ? "Копировать ключ" : "Показать и скопировать ключ"}
            </button>
            {exportedKey && (
              <div className="notes-exported-key">
                <code>{exportedKey}</code>
              </div>
            )}
          </div>

          <div className="notes-settings-section">
            <div className="notes-settings-section-title">Восстановить из ключа</div>
            <p className="notes-settings-section-text">
              Вставь ключ с другого устройства, чтобы расшифровать заметки здесь.
            </p>
            <div className="notes-settings-import">
              <KeyRound size={14} className="notes-settings-import-icon" />
              <input
                type="text"
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder="64 hex-символа (32 байта)"
                spellCheck={false}
                aria-label="Ключ шифрования заметок"
              />
              <button type="button" onClick={handleImport} disabled={!importValue.trim()}>
                {restored ? "Готово" : "Восстановить"}
              </button>
            </div>
            {importError && <div className="notes-settings-import-error">{importError}</div>}
            {importWarn && <div className="notes-settings-import-warn">{importWarn}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
