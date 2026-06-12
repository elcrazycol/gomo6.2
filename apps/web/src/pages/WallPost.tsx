import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "@/integrations/api/compat";
import { ProfileWall } from "@/components/ProfileWall";

async function getToken(): Promise<string | undefined> {
  const { data: { session } } = await api.auth.getSession();
  return session?.access_token;
}

const WallPost = () => {
  const { userId, postId } = useParams();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPageContext = async () => {
      try {
        const [{ data: authData }, profileResult] = await Promise.all([
          api.auth.getUser(),
          userId
            ? fetch(`/api/v1/profiles?id=eq.${userId}`).then(r => r.json())
            : Promise.resolve({ success: true, data: [] }),
        ]);

        const authUser = authData.user;
        setCurrentUserId(authUser?.id || null);

        if (authUser?.id) {
          const currResponse = await fetch(`/api/v1/profiles?id=eq.${authUser.id}`);
          const currResult = await currResponse.json();
          const currentProfile = currResult.data?.[0] || null;
          setCurrentUsername(currentProfile?.username || "");
        } else {
          setCurrentUsername("");
        }

        const profileData = profileResult.data?.[0] || null;
        setProfileUsername(profileData?.username || "");
      } finally {
        setLoading(false);
      }
    };

    void loadPageContext();
  }, [userId]);

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
