// Frontend Web Push service.
//
// Flow:
//  1. The user enables push (Settings → Notifications). We fetch the VAPID
//     public key, request Notification permission, then PushManager.subscribe
//     with that key.
//  2. The resulting PushSubscription (endpoint + p256dh + auth) is POSTed to
//     /api/v1/push/subscribe so the backend can deliver.
//  3. Per-type preferences (which notification types produce a push) are read
//     and persisted through /api/v1/push/preferences.
//
// Delivery itself happens server-side; the service worker (src/sw.ts) handles
// the `push` and `notificationclick` events that display the banner.

import { apiClient } from "@/integrations/api/client";
import { isNativePlatform } from "@/lib/capacitor";

export interface PushPreferences {
  type_map: Record<string, boolean>;
  available_types: string[];
  vapid_public_key: string;
}

// Base64url → Uint8Array, required by PushManager.subscribe's
// applicationServerKey. VAPID public keys are base64url-encoded P-256 points.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isPushSupported(): boolean {
  // Web Push (VAPID + service worker) is browser-only: inside the Capacitor
  // native shell the WebView would happily report PushManager support but the
  // subscription could never deliver — native push (APNs/FCM) is a separate
  // backend flow, so the toggle stays hidden there.
  if (isNativePlatform()) return false;
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getVapidPublicKey(): Promise<string> {
  const resp = await apiClient.request<{ vapid_public_key: string }>("/api/v1/push/vapid-public-key");
  const data = resp.data as { vapid_public_key?: string } | null;
  return data?.vapid_public_key || "";
}

export async function getPushPreferences(): Promise<PushPreferences | null> {
  try {
    const resp = await apiClient.request<PushPreferences>("/api/v1/push/preferences");
    return resp.data as PushPreferences | null;
  } catch {
    return null;
  }
}

export async function updatePushPreferences(typeMap: Record<string, boolean>): Promise<boolean> {
  try {
    const resp = await apiClient.request<{ updated: boolean }>("/api/v1/push/preferences", {
      method: "PUT",
      body: JSON.stringify({ type_map: typeMap }),
    });
    return (resp.data as { updated?: boolean } | null)?.updated ?? true;
  } catch {
    return false;
  }
}

// Convert a binary ArrayBuffer/TypedArray (from PushSubscription.getKey) to a
// base64 string the backend stores and the webpush library decodes.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Register the current browser's push subscription with the backend. */
async function registerSubscription(sub: PushSubscription): Promise<boolean> {
  if (!sub.getKey("p256dh") || !sub.getKey("auth")) return false;
  try {
    const resp = await apiClient.request<{ subscribed: boolean }>("/api/v1/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: arrayBufferToBase64(sub.getKey("p256dh")!),
        auth: arrayBufferToBase64(sub.getKey("auth")!),
        user_agent: navigator.userAgent || "",
      }),
    });
    return (resp.data as { subscribed?: boolean } | null)?.subscribed ?? true;
  } catch {
    return false;
  }
}

/** Remove the current subscription from the backend (endpoint identifies it). */
export async function unregisterSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const resp = await apiClient.request<{ unsubscribed: boolean }>("/api/v1/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    return (resp.data as { unsubscribed?: boolean } | null)?.unsubscribed ?? true;
  } catch {
    return false;
  }
}

/**
 * Enable push on this device: request permission and subscribe this browser,
 * then register the subscription with the backend. Returns true when fully
 * subscribed, false otherwise. Safe to call repeatedly (idempotent).
 */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const vapidPublicKey = await getVapidPublicKey();
  if (!vapidPublicKey) return false;

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return false;
  }
  if (permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }
    return await registerSubscription(sub);
  } catch {
    return false;
  }
}

/**
 * Disable push on this device: unsubscribe the browser and remove the
 * subscription from the backend. What the user chooses for *which types* push
 * (per-type preferences) is independent and stored server-side.
 */
export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return true;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await unregisterSubscription(sub);
      await sub.unsubscribe();
    }
    return true;
  } catch {
    return false;
  }
}

/** Whether this browser already has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}
