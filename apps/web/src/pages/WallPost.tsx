import { useEffect, useRef, useState } from "react";
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
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

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
    setIsExiting(true);

    const returnKind = wallPostReturn ?? (userId ? "profile" : undefined);

    // React Router unmounts this page the moment we navigate, so snapshot it
    // into a fixed overlay first. The overlay keeps the post visible on top
    // while the destination route mounts underneath; without it the user sees
    // a blank page until the profile/feed finishes loading.
    const source = document.querySelector<HTMLElement>('[data-testid="wall-post-page"]');
    let overlay: HTMLElement | null = null;
    if (source) {
      overlay = source.cloneNode(true) as HTMLElement;
      overlay.removeAttribute("data-testid");
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.remove("wall-post-page-enter");
      const rect = source.getBoundingClientRect();
      overlay.style.position = "fixed";
      overlay.style.top = `${rect.top}px`;
      overlay.style.left = `${rect.left}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.zIndex = "9999";
      overlay.style.overflow = "hidden";
      overlay.style.backgroundColor = "hsl(var(--background))";
      overlay.style.pointerEvents = "none";
      document.body.appendChild(overlay);
    }

    // Navigate immediately so the destination can mount under the overlay.
    if (window.history.length > 1) {
      navigate(-1);
    } else if (userId) {
      navigate(`/profile/${userId}`, { replace: true });
    }

    // Slide the snapshot away only once the destination has actually rendered
    // its content (signalled via data-wall-return-ready), never over a blank
    // Suspense fallback or a loading skeleton.
    const waitForReady = returnKind
      ? new Promise<void>((resolve) => {
          const selector = `[data-wall-return-ready="${returnKind}"]`;
          const deadline = Date.now() + 2000;
          const poll = () => {
            if (document.querySelector(selector) || Date.now() >= deadline) {
              resolve();
              return;
            }
            window.requestAnimationFrame(poll);
          };
          poll();
        })
      : Promise.resolve();

    void waitForReady.then(() => {
      if (!overlay) return;
      overlay.classList.add("wall-post-page-exit");
      window.setTimeout(() => overlay?.remove(), 500);
    });
  };

  // Swipe right to go back — the same action as the back button. Horizontal
  // dominance + threshold keeps it from fighting the vertical scroll of the
  // comment list.
  const handleTouchStart = (event: React.TouchEvent) => {
    if (event.targetTouches.length !== 1) return;
    touchStartRef.current = {
      x: event.targetTouches[0].clientX,
      y: event.targetTouches[0].clientY,
    };
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    const threshold = 70;

    if (dx > threshold && dx > dy) {
      goBack();
    }
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
      className="wall-post-page-enter mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-3 sm:p-5"
      data-testid="wall-post-page"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: "pan-y" }}
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
