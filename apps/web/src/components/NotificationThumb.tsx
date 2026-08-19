import { useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";
import type { Notification } from "@/integrations/api/client";
import { notificationThumbTarget } from "@/utils/notifications";
import { storageUrl } from "@/utils/storage";

interface ThumbEntry {
  url: string | null;
}

// Module-level cache so the same post is fetched once per session even when it
// appears in several notifications (e.g. multiple likes on one wall post).
const thumbCache = new Map<string, ThumbEntry>();

const resolveContentUrl = (raw: string | null | undefined): string | null =>
  raw ? storageUrl("content", raw) || raw : null;

const firstImageFromAttachments = (attachments: unknown): string | null => {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments) {
    const att = a as { type?: string; url?: string } | null;
    if (att?.type === "image" && att.url) return att.url;
  }
  return null;
};

async function resolveNotificationThumbUrl(notif: Notification): Promise<string | null> {
  const target = notificationThumbTarget(notif);
  if (!target) return null;

  const key = `${target.kind}:${target.id}`;
  const cached = thumbCache.get(key);
  if (cached) return cached.url;

  let url: string | null = null;

  if (target.kind === "wall") {
    const { data, error } = await api
      .from("profile_wall_posts")
      .select("image_url, attachments")
      .eq("id", target.id)
      .maybeSingle();
    const d = data as { image_url?: string | null; attachments?: unknown } | null;
    url = error ? null : resolveContentUrl(firstImageFromAttachments(d?.attachments) || d?.image_url);
  } else if (target.kind === "post") {
    const { data, error } = await api
      .from("posts")
      .select("image_url, image_urls, attachments")
      .eq("id", target.id)
      .maybeSingle();
    const d = data as { image_url?: string | null; image_urls?: string[] | null; attachments?: unknown } | null;
    const firstUrl = Array.isArray(d?.image_urls) ? d.image_urls[0] : d?.image_urls;
    url = error
      ? null
      : resolveContentUrl(firstImageFromAttachments(d?.attachments) || d?.image_url || firstUrl);
  } else {
    const { data, error } = await api
      .from("threads")
      .select("image_url, image_urls")
      .eq("id", target.id)
      .maybeSingle();
    const d = data as { image_url?: string | null; image_urls?: string[] | null } | null;
    const firstUrl = Array.isArray(d?.image_urls) ? d.image_urls[0] : d?.image_urls;
    url = error ? null : resolveContentUrl(d?.image_url || firstUrl);
  }

  thumbCache.set(key, { url });
  return url;
}

export const NotificationThumb = ({ notification }: { notification: Notification }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveNotificationThumbUrl(notification)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [notification]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-12 w-12 shrink-0 rounded-lg border border-border/60 object-cover"
    />
  );
};
