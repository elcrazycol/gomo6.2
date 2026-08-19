import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { EmbeddedWallPost } from "@/components/WallEmbeddedPost";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { type WallPost, normalizeWallPostRecord } from "@/utils/wallNormalizers";

const pluralPosts = (n: number) => {
  if (n % 10 === 1 && n % 100 !== 11) return "запись";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "записи";
  return "записей";
};

const NotificationLikes = () => {
  const { notificationId } = useParams();
  const { loadProfile } = useProfileCache();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [actor, setActor] = useState<{ username?: string } | null>(null);
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (!notificationId) {
        setError(true);
        setLoading(false);
        return;
      }

      try {
        const [authResp, notifResp] = await Promise.all([
          api.auth.getUser(),
          apiClient.getNotification(notificationId),
        ]);

        const authUser = (authResp.data as { user?: { id?: string } } | undefined)?.user;
        const currentId = authUser?.id || null;
        setCurrentUserId(currentId);

        const currentMeta = currentId
          ? await getCurrentUserMeta(currentId)
          : { username: "" };
        setCurrentUsername(currentMeta.username);

        const notif = notifResp.data as {
          related_user_id?: string | null;
          related_wall_post_ids?: string[] | null;
        } | null;

        if (notif?.related_user_id) {
          const p = await loadProfile(notif.related_user_id);
          setActor({ username: p.username });
        }

        const ids = (notif?.related_wall_post_ids ?? []).filter(Boolean);
        if (ids.length === 0) {
          setError(true);
          setLoading(false);
          return;
        }

        const { data, error: postsError } = await api
          .from("profile_wall_posts")
          .select(`\n            id,\n            user_id,\n            author_id,\n            title,\n            content,\n            content_json,\n            image_url,\n            attachments,\n            repost_of_post_id,\n            created_at,\n            updated_at,\n            is_pinned,\n            pinned_order,\n            author:profiles!author_id (\n              username,\n              is_anonymous,\n              avatar_url\n            )\n          `)
          .in("id", ids);

        if (postsError) throw postsError;

        const raw = (data || []) as Record<string, unknown>[];
        const ordered = ids
          .map((id) => raw.find((p) => p.id === id))
          .filter((p): p is Record<string, unknown> => Boolean(p))
          .map((p) => normalizeWallPostRecord(p, currentMeta.username));

        setPosts(ordered);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [notificationId, loadProfile]);

  const handleImageClick = useCallback((items: LightboxItem[], index: number) => {
    setGalleryItems(items);
    setGalleryIndex(index);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-3 sm:p-5">
      <div className="flex items-center gap-3">
        <Link
          to="/notify"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Назад к уведомлениям</span>
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-bold">
          {actor?.username ? `@${actor.username} оценил(а) эти записи` : "Записи, которые понравились"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {posts.length > 0 ? `${posts.length} ${pluralPosts(posts.length)}` : ""}
        </p>
      </header>

      {error || posts.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Записи не найдены.
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <EmbeddedWallPost
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              onImageClick={handleImageClick}
              hideHeader
            />
          ))}
        </div>
      )}

      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </main>
  );
};

export default NotificationLikes;
