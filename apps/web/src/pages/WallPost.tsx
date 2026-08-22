import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useDrag } from "@use-gesture/react";
import { api } from "@/integrations/api/compat";
import { ProfileWall } from "@/components/ProfileWall";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { consumeWallReturnUnderlay } from "@/lib/wallReturnUnderlay";
import type { WallPost as WallPostData } from "@/utils/wallNormalizers";

const SWIPE_THRESHOLD = 90;

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

  // Snapshot of the page the user came from (profile/feed), revealed underneath
  // the post while it is dragged back. Consumed lazily once so React StrictMode
  // re-renders do not drop it.
  const underlayDataRef = useRef<ReturnType<typeof consumeWallReturnUnderlay> | undefined>(undefined);
  if (underlayDataRef.current === undefined) {
    underlayDataRef.current = consumeWallReturnUnderlay();
  }
  const underlay = underlayDataRef.current;
  const underlayContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!underlay || !underlayContainerRef.current) return;
    const container = underlayContainerRef.current;
    container.appendChild(underlay.node);
    return () => {
      if (underlay.node.parentNode === container) {
        container.removeChild(underlay.node);
      }
    };
  }, [underlay]);

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
  // `startX` is the swipe offset the finger left the page at, so the slide-out
  // continues from there instead of snapping back to the left edge.
  const goBack = (startX = 0) => {
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
      // Reset any in-progress swipe offset on the inner surface so it does not
      // stack with the overlay's own slide, then start the exit from where the
      // finger stopped (0 for the back button).
      const swipeEl = overlay.querySelector<HTMLElement>("[data-wall-post-swipe]");
      if (swipeEl) {
        swipeEl.style.transform = "none";
        swipeEl.style.transition = "none";
      }
      overlay.style.transform = `translate3d(${startX}px, 0, 0)`;
      overlay.style.setProperty("--wall-post-exit-x", `${startX}px`);
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

  // Interactive swipe-to-go-back: the page follows the finger horizontally
  // (right only) and springs back unless the swipe passes the threshold. The
  // same drag primitive used for the messenger swipe-reply.
  const isTouchDevice = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const bind = useDrag(
    ({ movement: [mx], last, active }) => {
      if (!isTouchDevice) return;
      setIsDragging(active);
      if (active) {
        setSwipeOffset(Math.max(0, Math.min(window.innerWidth * 0.9, mx)));
      } else {
        if (last && mx > SWIPE_THRESHOLD) {
          goBack(mx);
        }
        setSwipeOffset(0);
      }
    },
    { axis: "x", filterTaps: true, threshold: 8, from: () => [0, 0] },
  );

  if (!userId || !postId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">Запись не найдена.</div>
      </main>
    );
  }

  return (
    <>
      {underlay && createPortal(
        <div
          ref={underlayContainerRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        />,
        document.body,
      )}
      <main
        className="wall-post-page-enter relative z-10 flex w-full flex-1 flex-col"
        data-testid="wall-post-page"
      >
      <div
        {...bind()}
        data-wall-post-swipe=""
        className="flex min-h-screen w-full flex-col bg-background"
        style={{
          transform: `translateX(${swipeOffset}px)`,
          touchAction: "pan-y",
          transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goBack()}
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
        </div>
      </div>
      </main>
    </>
  );
};

export default WallPost;
