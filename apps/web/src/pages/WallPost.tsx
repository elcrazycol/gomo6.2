import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { ProfileWall } from "@/components/ProfileWall";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import type { WallPost as WallPostData } from "@/utils/wallNormalizers";

type WallPostNavigationState = {
  wallPost?: WallPostData;
  wallPostReturn?: "profile" | "feed";
};

// The destination route is lazy. Warm its chunk up before navigating back so
// the profile/feed mounts immediately and the post slides away over real
// content instead of a blank Suspense fallback.
const preloadDestination = (kind: "profile" | "feed" | undefined): Promise<void> => {
  if (kind === "profile") {
    return import("./Profile").then(() => undefined);
  }
  if (kind === "feed") {
    return import("./Index").then(() => undefined);
  }
  return Promise.resolve();
};

const WallPost = () => {
  const { userId, postId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as WallPostNavigationState | null;
  const initialPost = navigationState?.wallPost ?? null;
  const wallPostReturn = navigationState?.wallPostReturn;
  const { loadProfile } = useProfileCache();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

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

  // Go back to wherever the post was opened from (feed, notifications,
  // messenger, profile wall). Fall back to the profile page when the post was
  // opened directly (shared link / fresh tab) and there is no in-app history.
  const goBack = () => {
    if (isExiting) return;

    const goToPreviousPage = () => {
      if (window.history.length > 1) {
        // The numeric navigate overload does not accept options; the native
        // transition wrapper below handles the animation for history back.
        navigate(-1);
      } else if (userId) {
        navigate(`/profile/${userId}`, { replace: true });
      }
    };

    const playCssExitFallback = () => {
      // Older Safari/Firefox fallback: warm the destination chunk first, then
      // keep the post mounted long enough to play the exit animation before
      // changing the route. The preload makes the destination paint instantly
      // instead of flashing a blank Suspense fallback under the slide.
      setIsExiting(true);
      preloadDestination(wallPostReturn).then(() => {
        window.setTimeout(goToPreviousPage, 380);
      });
    };

    // BrowserRouter is intentionally used in this app instead of a data
    // router, so its numeric navigate() overload does not accept
    // { viewTransition: true }. Use the native API directly, but hold the
    // outgoing post snapshot until the destination profile/feed has actually
    // rendered its content. Resolving after two frames was not enough: the
    // destination is a lazy route, so two frames later it was still the
    // blank Suspense fallback and the post slid out over an empty page.
    const waitForDestination = () => new Promise<void>((resolve) => {
      const finishAfterTwoFrames = () => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      };

      if (!wallPostReturn) {
        finishAfterTwoFrames();
        return;
      }

      const selector = `[data-wall-return-ready="${wallPostReturn}"]`;
      const deadline = Date.now() + 2000;
      const wait = () => {
        if (document.querySelector(selector) || Date.now() >= deadline) {
          finishAfterTwoFrames();
          return;
        }
        window.requestAnimationFrame(wait);
      };
      wait();
    });

    const supportsViewTransition = typeof document !== "undefined"
      && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === "function";
    if (supportsViewTransition) {
      const startViewTransition = (document as Document & {
        startViewTransition: (update: () => void | Promise<void>) => unknown;
      }).startViewTransition;
      try {
        startViewTransition(() => {
          goToPreviousPage();
          return waitForDestination();
        });
      } catch {
        // A partially implemented WebView API should not strand the user on
        // the post page; fall back to the CSS exit animation.
        playCssExitFallback();
      }
      return;
    }

    playCssExitFallback();
  };

  if (!userId || !postId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">Запись не найдена.</div>
      </main>
    );
  }

  return (
    <main
      className={`wall-post-page-enter mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-3 sm:p-5${isExiting ? " wall-post-page-exit" : ""}`}
      data-testid="wall-post-page"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Назад</span>
        </button>

        <div className="text-sm text-muted-foreground">
          {profileUsername ? `Запись на стене @${profileUsername}` : "Запись на стене"}
        </div>
      </div>

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
    </main>
  );
};

export default WallPost;
