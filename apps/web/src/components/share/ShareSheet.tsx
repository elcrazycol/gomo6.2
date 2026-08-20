import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, Check, Copy, Loader2, MessageSquare, Search, Send, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { storageUrl } from "@/utils/storage";
import { searchProfiles, type ProfileSearchResult } from "@/utils/searchProfiles";
import { useMessengerStore } from "@/stores/messengerStore";
import type { ConversationView } from "@/components/messenger/types";
import { buildShareToken, type ShareTarget } from "./share";

// ─── Selection model ────────────────────────────────────────────────────────
type SelectedContact =
  | { kind: "conversation"; conv: ConversationView }
  | { kind: "user"; user: ProfileSearchResult };

const MAX_CONTACTS = 10;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function contactName(conv: ConversationView): string {
  if (conv.is_group) return conv.group_name || "Группа";
  return conv.other_display_name || conv.other_username || "Пользователь";
}

function contactAvatar(conv: ConversationView): string | null {
  if (conv.is_group) return storageUrl("post-images", conv.group_avatar_url ?? null);
  return storageUrl("post-images", conv.other_avatar_url ?? null);
}

function contactId(conv: ConversationView): string {
  return conv.is_group ? conv.id : conv.other_user_id ?? conv.id;
}

function clientId(): string {
  return `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being shared (encoded into the chat message token). */
  target: ShareTarget;
  /** Absolute URL of the shared content (used for copy / socials / chat card). */
  url: string;
  /** Short text used in social share links. */
  title: string;
}

/**
 * X-style share sheet: recent chats + search on top, system share / socials
 * at the bottom. Picking a contact swaps the bottom panel for a message field
 * + send — the share card is sent first, then the optional text as a reply to
 * it. Mobile renders as a bottom drawer, desktop as a centered dialog.
 */
export const ShareSheet = ({ open, onOpenChange, target, url, title }: ShareSheetProps) => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const conversations = useMessengerStore((s) => s.conversations);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedContact | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load the messenger list when the sheet opens (init is idempotent and
  // normally already done by ChatIcon in the app header).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const store = useMessengerStore.getState();
      if (!store.me) await store.init();
      if (cancelled) return;
      await useMessengerStore.getState().loadConversations();
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset per-open state.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(null);
    setMessage("");
    setSending(false);
    setSearchResults([]);
  }, [open]);

  // Search across ALL users (not only existing chats) while typing.
  useEffect(() => {
    if (!open || !query.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    void searchProfiles(query.trim()).then((results) => {
      if (!cancelled) setSearchResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  // Focus the search box on open (desktop) / phase-2 message field (mobile).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (!selected) inputRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [open, selected]);

  const recent = useMemo(() => {
    // The selected chat stays in the list (highlighted) so tapping it again
    // deselects it; only the notes self-chat is never shareable.
    return conversations.filter((c) => !c.is_notes).slice(0, MAX_CONTACTS);
  }, [conversations]);

  const queryNorm = query.trim().toLowerCase();

  const filteredConversations = useMemo(() => {
    if (!queryNorm) return recent;
    return recent.filter((c) => contactName(c).toLowerCase().includes(queryNorm));
  }, [recent, queryNorm]);

  // Search matches that are not already a conversation row.
  const extraUsers = useMemo(() => {
    if (!queryNorm) return [];
    const knownIds = new Set(recent.map(contactId));
    return searchResults
      .filter((u) => !knownIds.has(u.id))
      .slice(0, 5);
  }, [queryNorm, searchResults, recent]);

  const selectContact = useCallback((next: SelectedContact) => {
    setSelected((prev) => {
      if (!prev || prev.kind !== next.kind) return next;
      if (next.kind === "conversation") {
        return prev.kind === "conversation" && prev.conv.id === next.conv.id ? null : next;
      }
      return prev.kind === "user" && prev.user.id === next.user.id ? null : next;
    });
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  }, [url]);

  const nativeShare = useCallback(async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, text: title, url });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error("Не удалось поделиться записью");
      }
    }
  }, [title, url]);

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(title);

  const sendShare = useCallback(async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      const store = useMessengerStore.getState();
      if (!store.me) {
        toast.error("Войди в аккаунт, чтобы поделиться в чате");
        return;
      }
      let convId: string | null = null;
      if (selected.kind === "conversation") {
        convId = selected.conv.id;
      } else {
        convId = await store.createConversation(selected.user.id);
      }
      if (!convId) {
        toast.error("Не удалось открыть чат");
        return;
      }

      const token = buildShareToken(target);
      const shareMessageId = await store.sendMessage(token, clientId(), undefined, undefined, convId);
      if (!shareMessageId) {
        toast.error("Не удалось отправить");
        return;
      }

      const text = message.trim();
      if (text) {
        await store.sendMessage(text, clientId(), shareMessageId, undefined, convId);
      }

      setSending(false);
      close();
      toast.success("Отправлено", {
        action: {
          label: "Открыть",
          onClick: () => navigate(`/messages?conversation=${convId}`),
        },
      });
    } catch {
      setSending(false);
      toast.error("Не удалось отправить");
    }
  }, [selected, sending, message, target, close, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendShare();
      }
    },
    [sendShare],
  );

  const socialLinks = useMemo(
    () => [
      { label: "Telegram", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` },
      { label: "X", href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}` },
      { label: "VK", href: `https://vk.com/share.php?url=${encodedUrl}` },
      { label: "WhatsApp", href: `https://wa.me/?text=${encodedText}%0A${encodedUrl}` },
      {
        label: "Email",
        href: `mailto:?subject=${encodedText}&body=${encodedText}%0A%0A${encodedUrl}`,
      },
    ],
    [encodedUrl, encodedText],
  );

  // ── Body ───────────────────────────────────────────────────────────────
  const body = (
    <div className="flex max-h-[70vh] flex-col gap-3 p-4 sm:p-5">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти чат или пользователя…"
          className="pl-9"
        />
      </div>

      {/* Contact list */}
      <div className="flex-1 space-y-0.5 overflow-y-auto pr-1">
        {!queryNorm && (
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Недавние чаты
          </p>
        )}
        {filteredConversations.map((conv) => {
          const active = selected?.kind === "conversation" && selected.conv.id === conv.id;
          const name = contactName(conv);
          const avatar = contactAvatar(conv);
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => selectContact({ kind: "conversation", conv })}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent${
                active ? " bg-accent ring-1 ring-primary/40" : ""
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                {avatar ? (
                  <img src={avatar} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span>{name[0]?.toUpperCase()}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {conv.last_message_preview || (conv.is_group ? `${conv.member_count} участников` : "Чат")}
                </span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}

        {extraUsers.map((user) => {
          const active = selected?.kind === "user" && selected.user.id === user.id;
          const avatar = user.avatar_url ? storageUrl("post-images", user.avatar_url) : null;
          return (
            <button
              key={user.id}
              type="button"
              onClick={() => selectContact({ kind: "user", user })}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent${
                active ? " bg-accent ring-1 ring-primary/40" : ""
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                {avatar ? (
                  <img src={avatar} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span>{user.username[0]?.toUpperCase()}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">@{user.username}</span>
                <span className="block truncate text-xs text-muted-foreground">Начать чат</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}

        {queryNorm && filteredConversations.length === 0 && extraUsers.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">Никого не нашлось</p>
        )}
        {!queryNorm && filteredConversations.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">Нет чатов</p>
        )}
      </div>

      {/* Bottom panel: pick phase → compose phase */}
      {selected ? (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {selected.kind === "conversation"
                ? (() => {
                    const avatar = contactAvatar(selected.conv);
                    return avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <span>{contactName(selected.conv)[0]}</span>;
                  })()
                : <span>@{selected.user.username[0]?.toUpperCase()}</span>}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {selected.kind === "conversation" ? contactName(selected.conv) : `@${selected.user.username}`}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Отменить выбор"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Сообщение (необязательно)"
              className="flex-1"
              maxLength={4000}
            />
            <Button
              type="button"
              size="icon"
              onClick={() => void sendShare()}
              disabled={sending}
              className="shrink-0"
              aria-label="Отправить"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Сообщение отправится ответом на карточку</p>
        </div>
      ) : (
        <div className="border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {typeof navigator.share !== "undefined" && (
              <Button type="button" variant="outline" size="sm" onClick={() => void nativeShare()}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> Системно
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Ссылка
            </Button>
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            Выбери чат — отправится карточка записи
          </p>
        </div>
      )}
    </div>
  );

  const header = (
    <DialogHeader className="text-left">
      <DialogTitle className="flex items-center gap-2 text-base">
        <Share2 className="h-4 w-4" />
        Поделиться
        <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
      </DialogTitle>
    </DialogHeader>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="mx-auto w-full max-w-md rounded-t-[14px] pb-4">
          <DrawerHeader className="pb-0 text-left">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4" />
              Поделиться
            </DrawerTitle>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border/70 bg-background">
        {header}
        {body}
      </DialogContent>
    </Dialog>
  );
};
