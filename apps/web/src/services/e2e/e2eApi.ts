import { apiClient } from "@/integrations/api/client";

const BASE = "/api/v1/e2e";
const TOKEN = () => localStorage.getItem("auth_token") ?? "";

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = async (token: string) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    let json: Record<string, unknown> = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok) {
      const err = new Error(
        (json.error as string) || `HTTP ${res.status}`
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json.data as T;
  };

  try {
    return await doFetch(TOKEN());
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 401) {
      const newToken = await apiClient.tryRefreshToken();
      if (newToken) {
        return await doFetch(newToken);
      }
      apiClient.clearTokens();
      window.dispatchEvent(new CustomEvent("auth:expired"));
      throw new Error("Session expired");
    }
    throw e;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegisterKeysPayload {
  device_id: string;
  public_identity_key: string;
  public_signed_pre_key: string;
  signed_pre_key_signature: string;
  one_time_pre_keys: { id: string; public_key: string }[];
}

export interface DeviceKeyBundle {
  device_id: string;
  public_identity_key: string;
  public_signed_pre_key: string;
  signed_pre_key_signature: string;
  one_time_pre_key: { id: string; public_key: string } | null;
}

export interface DeviceInfo {
  device_id: string;
  created_at: string;
  updated_at: string;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function registerKeys(
  payload: RegisterKeysPayload
): Promise<{ registered_keys: number }> {
  return req("/keys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchKeyBundle(
  userId: string
): Promise<{ devices: DeviceKeyBundle[] }> {
  return req(`/keys/${userId}`);
}

export async function consumePreKey(
  prekeyId: string
): Promise<{ success: boolean }> {
  return req("/keys/consume-prekey", {
    method: "POST",
    body: JSON.stringify({ prekey_id: prekeyId }),
  });
}

export async function uploadPreKeys(
  prekeys: { id: string; public_key: string }[]
): Promise<{ success: boolean; count: number }> {
  return req("/keys/prekeys", {
    method: "POST",
    body: JSON.stringify({ prekeys }),
  });
}

export async function listDevices(): Promise<{ devices: DeviceInfo[] }> {
  return req("/devices");
}

export async function deleteDevice(
  deviceId: string
): Promise<{ success: boolean }> {
  return req(`/devices/${deviceId}`, {
    method: "DELETE",
  });
}
