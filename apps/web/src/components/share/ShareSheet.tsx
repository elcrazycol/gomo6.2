import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowUpRight, Check, Copy, Loader2, Mail, Search, Send, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { storageUrl } from "@/utils/storage";
import { searchProfiles, type ProfileSearchResult } from "@/utils/searchProfiles";
import { useMessengerStore } from "@/stores/messengerStore";
import type { ConversationView } from "@/components/messenger/types";
import { TelegramIcon, VkIcon, WhatsAppIcon, XIcon } from "./shareIcons";
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
 *
 * The sheet is fully modal: outside clicks are swallowed (never reach the
 * page behind) and nothing is auto-focused, so focus cannot jump between
 * contacts on open. Close via the X button / Escape / drag-down.
 */
export const ShareSheet = ({ open, onOpenChange, target, url, title }: ShareSheetProps) => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const conversations = useMessengerStore((s) => s.conversations);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedContact | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);

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
      toast.success(t("share.linkCopied"));
    } catch {
      toast.error(t("share.linkCopyError"));
    }
  }, [url, t]);

  const nativeShare = useCallback(async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, text: title, url });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error(t("share.shareError"));
      }
    }
  }, [title, url, t]);

  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(title);

  const sendShare = useCallback(async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      const store = useMessengerStore.getState();
      if (!store.me) {
        toast.error(t("share.loginRequired"));
        return;
      }
      let convId: string | null = null;
      if (selected.kind === "conversation") {
        convId = selected.conv.id;
      } else {
        convId = await store.createConversation(selected.user.id);
      }
      if (!convId) {
        toast.error(t("share.openChatError"));
        return;
      }

      const token = buildShareToken(target);
      const shareMessageId = await store.sendMessage(token, clientId(), undefined, undefined, convId);
      if (!shareMessageId) {
        toast.error(t("share.sendError"));
        return;
      }

      const text = message.trim();
      if (text) {
        await store.sendMessage(text, clientId(), shareMessageId, undefined, convId);
      }

      setSending(false);
      close();
      toast.success(t("share.sent"), {
        action: {
          label: t("share.open"),
          onClick: () => navigate(`/messages?conversation=${convId}`),
        },
      });
    } catch {
      setSending(false);
      toast.error(t("share.sendError"));
    }
  }, [selected, sending, message, target, close, navigate, t]);

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
      {
        label: "Telegram",
        href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
        icon: <TelegramIcon className="h-5 w-5" />,
        color: "text-[#229ED9]",
      },
      {
        label: "X",
        href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
        icon: <XIcon className="h-4 w-4" />,
        color: "text-foreground",
      },
      {
        label: "VK",
        href: `https://vk.com/share.php?url=${encodedUrl}`,
        icon: <VkIcon className="h-5 w-5" />,
        color: "text-[#0077FF]",
      },
      {
        label: "WhatsApp",
        href: `https://wa.me/?text=${encodedText}%0A${encodedUrl}`,
        icon: <WhatsAppIcon className="h-5 w-5" />,
        color: "text-[#25D366]",
      },
      {
        label: "Email",
        href: `mailto:?subject=${encodedText}&body=${encodedText}%0A%0A${encodedUrl}`,
        icon: <Mail className="h-5 w-5" />,
        color: "text-[#EA4335]",
      },
    ],
    [encodedUrl, encodedText],
  );

  // Swallow outside clicks: the sheet must never let a tap leak through to
  // the content behind it (feed cards navigate on click). Close is explicit
  // via the X button / Escape (desktop) or drag-down (mobile).
  const swallowOutside = (e: Event) => e.preventDefault();

  // ── Body ───────────────────────────────────────────────────────────────
  const body = (
    <div className="flex max-h-[70vh] flex-col gap-3 p-4">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("share.searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {/* Contact list */}
      <div className="flex-1 space-y-0.5 overflow-y-auto pr-1">
        {!queryNorm && (
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("share.recentChats")}
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
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60${
                active ? " bg-primary/10" : ""
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
                  {conv.last_message_preview
                    || (conv.is_group ? t("share.members", { count: conv.member_count }) : t("share.chat"))}
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
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60${
                active ? " bg-primary/10" : ""
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
                <span className="block truncate text-xs text-muted-foreground">{t("share.startChat")}</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}

        {queryNorm && filteredConversations.length === 0 && extraUsers.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t("share.noResults")}</p>
        )}
        {!queryNorm && filteredConversations.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t("share.noChats")}</p>
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
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              aria-label={t("share.deselect")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("share.messagePlaceholder")}
              className="flex-1"
              maxLength={4000}
            />
            <Button
              type="button"
              size="icon"
              onClick={() => void sendShare()}
              disabled={sending}
              className="shrink-0"
              aria-label={t("common.send")}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("share.replyHint")}</p>
        </div>
      ) : (
        <div className="border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {typeof navigator.share !== "undefined" && (
              <Button type="button" variant="outline" size="sm" onClick={() => void nativeShare()}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> {t("share.systemShare")}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> {t("share.copyLink")}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                title={link.label}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-muted/60 ${link.color}`}
              >
                {link.icon}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        <DrawerContent
          className="mx-auto w-full max-w-md rounded-t-[14px] pb-5"
          onPointerDownOutside={swallowOutside}
          onInteractOutside={swallowOutside}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DrawerHeader className="px-4 pb-0 pt-3 text-left">
            <div className="flex items-center gap-2">
              <DrawerTitle className="flex items-center gap-2 text-base">
                <Share2 className="h-4 w-4" />
                {t("share.title")}
              </DrawerTitle>
              <DrawerClose asChild>
                <button
                  type="button"
                  className="ml-auto rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 border-border/70 bg-background p-0"
        onPointerDownOutside={swallowOutside}
        onInteractOutside={swallowOutside}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pb-0 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4" />
            {t("share.title")}
            <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};
