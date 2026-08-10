import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { ProfileWall } from "@/components/ProfileWall";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";

const WallPost = () => {
  const { userId, postId } = useParams();
  const { loadProfile } = useProfileCache();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPageContext = async () => {
      try {
        // Both lookups go through TTL caches (ProfileCacheContext 5min for the
        // wall owner, currentUserMeta 5min for the viewer), so revisiting a
        // wall post costs 0 network requests instead of 2 raw profile fetches.
        const [{ data: authData }, ownerProfile] = await Promise.all([
          api.auth.getUser(),
          userId ? loadProfile(userId) : Promise.resolve({ username: "" } as { username: string }),
        ]);

        const authUser = authData.user;
        setCurrentUserId(authUser?.id || null);

        const currentMeta = authUser?.id
          ? await getCurrentUserMeta(authUser.id)
          : { username: "" };
        setCurrentUsername(currentMeta.username);
        setProfileUsername(ownerProfile.username || "");
      } finally {
        setLoading(false);
      }
    };

    void loadPageContext();
  }, [userId, loadProfile]);

  if (!userId || !postId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">Запись не найдена.</div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/profile/${userId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Назад к профилю</span>
        </Link>

        <div className="text-sm text-muted-foreground">
          {profileUsername ? `Запись на стене @${profileUsername}` : "Запись на стене"}
        </div>
      </div>

      {!loading && (
        <ProfileWall
          profileUserId={userId}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          canPost={false}
          showWall
          focusedPostId={postId}
          standalone
        />
      )}
    </main>
  );
};

export default WallPost;
