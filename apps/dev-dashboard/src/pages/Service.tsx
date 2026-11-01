import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fingerprint, Megaphone, ImageIcon, UserRound } from "lucide-react";
import { toast } from "sonner";

/**
 * Official account (@gomo6) management.
 *
 * The account itself can never log in and cannot use messenger. Everything
 * published in its name goes through /api/v1/admin/service/*, which requires:
 * platform admin + a fresh passkey ceremony per action (X-Reauth-Token).
 * Each publish button runs the ceremony first, then fires the request —
 * one gesture, no standing token.
 */

interface ServiceAccount {
  user_id: string;
  username: string;
  display_name: string;
}

// ─── WebAuthn helpers (minimal, ceremony-scoped) ────────────────────────────

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function toPublicKey(opts: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const o = { ...(opts as Record<string, unknown>) } as Record<string, unknown>;
  o.challenge = b64ToBuf(opts.challenge as string);
  if (opts.allowCredentials) {
    o.allowCredentials = (opts.allowCredentials as Array<Record<string, string>>).map((c) => ({
      ...c,
      id: b64ToBuf(c.id),
    }));
  }
  return o as unknown as PublicKeyCredentialRequestOptions;
}

/** Run a passkey ceremony and return a single-use reauth token. */
async function ceremonyReauth(): Promise<string> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new Error("Этот браузер не поддерживает passkey");
  }
  const begin = await api.fetch("/api/v1/auth/webauthn/reauth/begin", { method: "POST" });
  const beginJson = await begin.json();
  const options = beginJson?.data?.options ?? beginJson?.options;
  if (!options) throw new Error("Не удалось начать церемонию (нет паскеев?)");
  const wrapped = (options as Record<string, unknown>).publicKey ?? options;
  const credential = (await navigator.credentials.get({
    publicKey: toPublicKey(wrapped as Record<string, unknown>),
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Церемония отменена");
  const response = credential.response as AuthenticatorAssertionResponse;
  const body: Record<string, unknown> = {
    id: credential.id,
    rawId: bufToB64(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufToB64(response.authenticatorData),
      clientDataJSON: bufToB64(response.clientDataJSON),
      signature: bufToB64(response.signature),
    },
  };
  if (response.userHandle) {
    (body.response as Record<string, unknown>).userHandle = bufToB64(response.userHandle);
  }
  const finish = await api.fetch("/api/v1/auth/webauthn/reauth/finish", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const finishJson = await finish.json();
  const token = finishJson?.data?.reauth_token ?? finishJson?.reauth_token;
  if (!token) throw new Error(finishJson?.error || "Подтверждение не удалось");
  return token as string;
}

/** POST with a fresh reauth token burned for this exact action. */
async function adminService(path: string, body: unknown, reauthToken: string): Promise<unknown> {
  const res = await api.fetch(`/api/v1/admin/service${path}`, {
    method: "POST",
    headers: { "X-Reauth-Token": reauthToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  return (json as { data?: unknown }).data;
}

async function adminServicePut(path: string, body: unknown, reauthToken: string): Promise<unknown> {
  const res = await api.fetch(`/api/v1/admin/service${path}`, {
    method: "PUT",
    headers: { "X-Reauth-Token": reauthToken },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  return (json as { data?: unknown }).data;
}

async function adminUpload(bucket: string, key: string, file: File, reauthToken: string): Promise<string> {
  const form = new FormData();
  form.append("bucket", bucket);
  form.append("key", key);
  form.append("file", file);
  const token = api.getToken();
  const res = await fetch(`/api/v1/admin/service/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Reauth-Token": reauthToken,
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Upload failed");
  return ((json as { data?: { key?: string } }).data?.key ?? key) as string;
}

// ─── Component ──────────────────────────────────────────────────────────────

const Service = () => {
  const [account, setAccount] = useState<ServiceAccount | null>(null);
  const [accountError, setAccountError] = useState("");
  const [busy, setBusy] = useState(false);

  // Post form
  const [postTitle, setPostTitle] = useState("");
  const [postText, setPostText] = useState("");
  const [postImage, setPostImage] = useState<File | null>(null);

  // Story form
  const [storyText, setStoryText] = useState("");
  const [storyImage, setStoryImage] = useState<File | null>(null);

  // Profile form
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);

  const loadAccount = async () => {
    try {
      const res = await api.fetch("/api/v1/admin/service/account");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Сервисный аккаунт не настроен");
      setAccount(json.data as ServiceAccount);
      setAccountError("");
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  useEffect(() => {
    loadAccount();
  }, []); // load once: account identity never changes during the session

  const extOf = (f: File) => {
    const m = /\.([a-z0-9]+)$/i.exec(f.name);
    return (m?.[1] ?? "jpg").toLowerCase();
  };

  const runWithReauth = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  // Reauth tokens are single-use: every backend action burns exactly one
  // ceremony. `need()` mints on demand, so multi-step flows touch the key
  // once per step and never waste a ceremony.
  const publishPost = () =>
    runWithReauth(async () => {
      if (!account) throw new Error("Нет service account");
      if (!postText.trim()) throw new Error("Введите текст поста");
      let imageUrl: string | undefined;
      if (postImage) {
        const key = `${account.user_id}/wall/${Date.now()}.${extOf(postImage)}`;
        imageUrl = await adminUpload("post-images", key, postImage, await ceremonyReauth());
      }
      await adminService(
        "/wall",
        { user_id: account.user_id, title: postTitle.trim(), content: postText.trim(), ...(imageUrl ? { image_url: imageUrl } : {}) },
        await ceremonyReauth(),
      );
      toast.success("Пост опубликован от имени @" + account.username);
      setPostTitle("");
      setPostText("");
      setPostImage(null);
    });

  const publishStory = () =>
    runWithReauth(async () => {
      if (!account) throw new Error("Нет service account");
      if (storyImage) {
        const key = `${account.user_id}/${Date.now()}.${extOf(storyImage)}`;
        const mediaKey = await adminUpload("stories", key, storyImage, await ceremonyReauth());
        await adminService(
          "/stories",
          { owner_type: "user", kind: "photo", media_key: mediaKey, privacy: "everyone" },
          await ceremonyReauth(),
        );
      } else {
        if (!storyText.trim()) throw new Error("Введите текст или выберите фото");
        await adminService(
          "/stories",
          { owner_type: "user", kind: "text", text: storyText.trim(), privacy: "everyone" },
          await ceremonyReauth(),
        );
      }
      toast.success("История опубликована");
      setStoryText("");
      setStoryImage(null);
    });

  const saveProfile = () =>
    runWithReauth(async () => {
      if (!account) throw new Error("Нет service account");
      let avatarUrl: string | undefined;
      if (avatarFile) {
        const key = `${account.user_id}/avatar_${Date.now()}.${extOf(avatarFile)}`;
        avatarUrl = await adminUpload("avatars", key, avatarFile, await ceremonyReauth());
      }
      let bannerUrl: string | undefined;
      if (bannerFile) {
        const key = `${account.user_id}/banner_${Date.now()}.${extOf(bannerFile)}`;
        bannerUrl = await adminUpload("post-images", key, bannerFile, await ceremonyReauth());
      }
      if (avatarUrl || displayName.trim() || bio.trim()) {
        await adminServicePut(
          "/profile",
          {
            ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
            ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
            ...(bio.trim() ? { bio: bio.trim() } : {}),
          },
          await ceremonyReauth(),
        );
      }
      if (bannerUrl) {
        await adminService(
          "/customization",
          { background_url: bannerUrl, background_variant: "banner" },
          await ceremonyReauth(),
        );
      }
      toast.success("Профиль обновлён");
      setAvatarFile(null);
      setBannerFile(null);
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-6 w-6" />
          Официальный аккаунт
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {account
            ? <>Постинг от имени <b>@{account.username}</b>. Каждое действие требует свежего подтверждения паскеем.</>
            : "Загрузка…"}
          {accountError && <span className="text-destructive"> {accountError}</span>}
        </p>
      </div>

      <Tabs defaultValue="post">
        <TabsList>
          <TabsTrigger value="post">Пост</TabsTrigger>
          <TabsTrigger value="story">История</TabsTrigger>
          <TabsTrigger value="profile">Профиль</TabsTrigger>
        </TabsList>

        <TabsContent value="post">
          <Card>
            <CardHeader>
              <CardTitle>Новый пост на стене @{account?.username ?? "…"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Заголовок (необязательно)</Label>
                <Input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} maxLength={80} />
              </div>
              <div className="space-y-2">
                <Label>Текст</Label>
                <Textarea value={postText} onChange={(e) => setPostText(e.target.value)} rows={5} maxLength={4000} />
              </div>
              <div className="space-y-2">
                <Label>Картинка (необязательно)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPostImage(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button onClick={publishPost} disabled={busy} className="gap-2">
                <Fingerprint className="h-4 w-4" />
                {busy ? "Публикация…" : "Подтвердить паскеем и опубликовать"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="story">
          <Card>
            <CardHeader>
              <CardTitle>Новая история</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Текст (для текстовой истории)</Label>
                <Textarea value={storyText} onChange={(e) => setStoryText(e.target.value)} rows={3} maxLength={1024} />
              </div>
              <div className="space-y-2">
                <Label>Фото (для фото-истории, до 24ч)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setStoryImage(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button onClick={publishStory} disabled={busy} className="gap-2">
                <Fingerprint className="h-4 w-4" />
                {busy ? "Публикация…" : "Подтвердить паскеем и опубликовать"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5" />
                Профиль @{account?.username ?? "…"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Отображаемое имя</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={account?.display_name}
                  maxLength={64}
                />
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Аватар
                </Label>
                <Input type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Баннер
                </Label>
                <Input type="file" accept="image/*" onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)} />
              </div>
              <Button onClick={saveProfile} disabled={busy} className="gap-2">
                <Fingerprint className="h-4 w-4" />
                {busy ? "Сохранение…" : "Подтвердить паскеем и сохранить"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Service;
