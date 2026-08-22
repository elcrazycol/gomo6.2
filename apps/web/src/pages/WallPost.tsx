import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, useMotionValue, animate } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { ProfileWall } from "@/components/ProfileWall";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import type { WallPost as WallPostData } from "@/utils/wallNormalizers";

const SWIPE_THRESHOLD = 90;

type WallPostNavigationState = {
  wallPost?: WallPostData;
  backgroundLocation?: { pathname: string };
};

const WallPost = () => {
  const { userId, postId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as WallPostNavigationState | null;
  const initialPost = navigationState?.wallPost ?? null;
  // When opened from the profile or feed the page is rendered as a full-screen
  // overlay above the still-mounted background route (background-location
  // pattern). A direct link renders as a plain in-layout page instead.
  const isOverlay = Boolean(navigationState?.backgroundLocation);
  const { loadProfile } = useProfileCache();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const x = useMotionValue(0);

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

  const goToPrevious = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else if (userId) {
      navigate(`/profile/${userId}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [navigate, userId]);

  // Overlay mode slides the surface out to the right, then goes back once it
  // is off screen. A direct link has no underlying page to reveal, so it just
  // navigates back immediately.
  const close = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    if (!isOverlay) {
      goToPrevious();
      return;
    }
    animate(x, window.innerWidth, {
      duration: 0.32,
      ease: [0.22, 1, 0.36, 1],
    }).then(goToPrevious);
  }, [isClosing, isOverlay, x, goToPrevious]);

  if (!userId || !postId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">Запись не найдена.</div>
      </main>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={close}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Назад</span>
      </button>

      <div className="text-sm text-muted-foreground">
        {profileUsername ? `Запись на стене @${profileUsername}` : "Запись на стене"}
      </div>
    </div>
  );

  const content = (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-3 sm:p-5">
      {header}

      {(initialPost || !loading) && (
        <ProfileWall
          profileUserId={userId}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          canPost={false}
          showWall
          focusedPostId={postId}
          initialPost={initialPost}
          standalone
        />
      )}
    </div>
  );

  // Direct link: plain in-layout page, no drag gesture.
  if (!isOverlay) {
    return <main className="flex w-full flex-1 flex-col">{content}</main>;
  }

  // Opened from profile/feed: full-screen overlay dragged over the live page.
  return (
    <motion.div
      data-testid="wall-post-page"
      className="fixed inset-0 z-[60] flex flex-col bg-background"
      style={{ x, touchAction: "pan-y" }}
      drag="x"
      dragConstraints={{ left: 0 }}
      dragElastic={{ left: 0 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 500) {
          close();
        } else {
          animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        }
      }}
    >
      <div className="h-full overflow-y-auto">{content}</div>
    </motion.div>
  );
};

export default WallPost;
