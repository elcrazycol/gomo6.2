import { lazy, Suspense, useLayoutEffect, useRef, useEffect, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { ChevronDown, Gift, Layers, LayoutGrid, MessageSquareText, Plus, Trophy, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProfileWall } from "@/components/ProfileWall";
import { ProfileAlbumView } from "@/components/ProfileAlbumView";
import {
  EASE_OUT_EXPO,
  morphOrigin,
  morphTransition,
  pressFeedback,
  SPATIAL_OFFSET,
  springFor,
  SPRING,
  travelDirection,
} from "@/lib/motion";
import { useProfileAlbums } from "./useProfileAlbums";
import { TrophyShowcase } from "@/components/TrophyShowcase";
import type { GiftCatalogItem } from "@/components/GiftCard";
import type { Trophy as TrophyData } from "@/utils/trophies";
import type { Profile } from "./types";

// Heavy interaction-only components — split into separate chunks so the
// profile page's initial JS is small on mobile. Loaded on first use (dialogs,
// non-default tabs) instead of on every visit.
const GiftsTab = lazy(() => import("@/components/GiftsTab").then((m) => ({ default: m.GiftsTab })));
const SubscriptionsPanel = lazy(() => import("@/components/SubscriptionsPanel").then((m) => ({ default: m.SubscriptionsPanel })));
const ProfileThreadsTab = lazy(() => import("./ProfileThreadsTab").then((m) => ({ default: m.ProfileThreadsTab })));
const ProfileAllTab = lazy(() => import("./ProfileAllTab").then((m) => ({ default: m.ProfileAllTab })));

export type ProfileTab = "all" | "wall" | "achievements" | "threads" | "gifts" | "subscribers";

/** Rendered left-to-right order of the tabs — the axis content travels along. */
const TAB_ORDER: ProfileTab[] = ["all", "wall", "achievements", "threads", "gifts", "subscribers"];

export interface ProfileTabsProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  userId: string;
  profile: Profile;
  isOwnProfile: boolean;
  isEditing: boolean;
  /** Forum layout: the bar sits inside a surface panel — match its background
   *  and round the corners instead of the full-bleed page strip. */
  panel?: boolean;
  /** Forum layout: wrap the active tab body in its own surface panel. Kept off
   *  for tabs whose content is already a set of cards (wall, threads, …). */
  contentPanel?: boolean;
  currentUser: { id: string } | null;
  currentUsername: string;
  currentUserColor: string;
  // Section visibility — derived by the page from the owner's privacy flags.
  allTabVisible: boolean;
  wallTabVisible: boolean;
  showThreadsTab: boolean;
  canViewAchievements: boolean;
  canViewThreads: boolean;
  canViewGifts: boolean;
  canViewSubscriptions: boolean;
  // Wall props
  showProfileWall: boolean;
  allowWallPostsFromOthers: boolean;
  wallHiddenFromViewer: boolean;
  privateProfile: boolean;
  wallRefreshKey: number;
  wallCreateOpen: boolean;
  onWallCreateOpenChange: (open: boolean) => void;
  // Trophies (hand-granted awards only — no quest content)
  trophies: TrophyData[];
  trophiesLoaded: boolean;
  // Gifts
  giftCatalog: GiftCatalogItem[];
  onGiftSent: () => void;
}

interface TabDef {
  key: ProfileTab;
  icon: LucideIcon;
  label: string;
}

/** Animated tab button: every tab is an icon; the active one expands to show
 * icon + label. The active strip (shared layoutId) slides between tabs along
 * the bottom edge and the label width animates open — delayed so the text
 * unfolds after the strip lands — then collapses when switching away. */
const TabButton = ({ tab, active, onClick, hideIndicator = false }: { tab: TabDef; active: boolean; onClick: () => void; hideIndicator?: boolean }) => {
  const Icon = tab.icon;
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      data-tab-key={tab.key}
      onClick={onClick}
      {...pressFeedback(reduceMotion)}
      transition={springFor("snappy", reduceMotion)}
      className={`relative flex touch-pan-y items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && !hideIndicator && (
        <motion.span
          layoutId="profile-tabs-indicator"
          className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-accent"
          transition={SPRING.snappy}
        />
      )}
      <Icon className="relative z-10 h-4 w-4 shrink-0" />
      <motion.span
        initial={false}
        animate={{ width: active ? "auto" : 0, opacity: active ? 1 : 0 }}
        transition={{
          ...springFor("reveal", reduceMotion),
          opacity: { duration: reduceMotion ? 0 : 0.16, ease: EASE_OUT_EXPO },
        }}
        style={morphOrigin({ x: 0 })}
        className="relative z-10 overflow-hidden whitespace-nowrap"
      >
        {tab.label}
      </motion.span>
    </motion.button>
  );
};

/** Wall tab: icon + label + the album chevron fused into one unit. The active
 * strip runs under the whole unit (label + chevron) so they read as one tab,
 * but the chevron is its own button with its own click handler — toggling the
 * album row never switches the tab. The chevron only appears while the wall
 * tab is active and there is something to reveal (albums or an owner who can
 * create them). */
const WallTabButton = ({
  active,
  label,
  onTabClick,
  showChevron,
  chevronOpen,
  onChevronClick,
  chevronTitle,
  hideIndicator = false,
}: {
  active: boolean;
  label: string;
  onTabClick: () => void;
  showChevron: boolean;
  chevronOpen: boolean;
  onChevronClick: () => void;
  chevronTitle: string;
  hideIndicator?: boolean;
}) => {
  const Icon = LayoutGrid;
  const reduceMotion = useReducedMotion();
  return (
    <div
      data-tab-key="wall"
      className={`relative flex touch-pan-y items-center rounded-lg text-xs sm:text-sm font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <motion.button
        onClick={onTabClick}
        {...pressFeedback(reduceMotion)}
        transition={springFor("snappy", reduceMotion)}
        className="flex items-center gap-1.5 py-2 pl-2.5 sm:pl-3 pr-1"
      >
        <Icon className="relative z-10 h-4 w-4 shrink-0" />
        <motion.span
          initial={false}
          animate={{ width: active ? "auto" : 0, opacity: active ? 1 : 0 }}
          transition={{
            ...springFor("reveal", reduceMotion),
            opacity: { duration: reduceMotion ? 0 : 0.16, ease: EASE_OUT_EXPO },
          }}
          style={morphOrigin({ x: 0 })}
          className="relative z-10 overflow-hidden whitespace-nowrap"
        >
          {label}
        </motion.span>
      </motion.button>
      <motion.span
        initial={false}
        animate={{ width: active && showChevron ? "auto" : 0, opacity: active && showChevron ? 1 : 0 }}
        transition={{
          ...springFor("reveal", reduceMotion),
          opacity: { duration: reduceMotion ? 0 : 0.16, ease: EASE_OUT_EXPO },
        }}
        className="relative z-10 overflow-hidden"
      >
        <button
          data-no-scrub
          onClick={onChevronClick}
          className={`flex items-center py-2 pr-2.5 pl-0.5 transition-colors ${
            chevronOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title={chevronTitle}
        >
          <motion.span
            className="inline-flex"
            animate={{ rotate: chevronOpen ? 180 : 0 }}
            transition={springFor("snappy", reduceMotion)}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>
      </motion.span>
      {active && !hideIndicator && (
        <motion.span
          layoutId="profile-tabs-indicator"
          className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-accent"
          transition={SPRING.snappy}
        />
      )}
    </div>
  );
};

// Subscribers tab button (people who follow this user). The list itself loads
// lazily inside the tab — the bar deliberately carries no counter: it would pop
// in only after the tab has been opened once and then stay stale until reload.
const SubscribersTabButton = ({ activeTab, onClick, hideIndicator = false }: { activeTab: string; onClick: () => void; hideIndicator?: boolean }) => {
  const { t } = useTranslation();
  return (
    <TabButton
      tab={{ key: "subscribers", icon: Users, label: t("profile.subscribers") }}
      active={activeTab === 'subscribers'}
      onClick={onClick}
      hideIndicator={hideIndicator}
    />
  );
};

/**
 * The scrubbing underline. It mounts on pointer-down at the grabbed tab's
 * underline rect, then every frame retargets to the active tab's centre. The
 * springs make it pull out from under the finger and overshoot slightly when
 * the active tab changes; the 2.5px line is the same element the `layoutId`
 * indicator would be, so the hand-over on release is invisible.
 */
function ScrubIndicator({
  rowRef,
  tabKey,
  initial,
}: {
  rowRef: { current: HTMLDivElement | null };
  tabKey: ProfileTab;
  initial: { x: number; w: number };
}) {
  const x = useSpring(initial.x, SPRING.snappy);
  const width = useSpring(initial.w, SPRING.snappy);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const btn = rowRef.current?.querySelector<HTMLElement>(`[data-tab-key="${tabKey}"]`);
      if (btn) {
        // Follow the label as it expands/collapses: the underline always ends
        // up under the active tab, never under the finger.
        x.set(btn.offsetLeft + 8);
        width.set(btn.offsetWidth - 16);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rowRef, tabKey, x, width]);

  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-1 left-0 z-20 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-accent"
      style={{ x, width }}
    />
  );
}

/** Profile tabs bar + active tab body. Visibility follows the owner's privacy
 * settings; for non-friends on a private profile the wall tab always stays
 * (it explains that the wall is hidden) while the rest follow the per-section
 * hide toggles. */
export function ProfileTabs({
  activeTab,
  onTabChange,
  userId,
  profile,
  isOwnProfile,
  panel = false,
  contentPanel = panel,
  currentUser,
  currentUsername,
  currentUserColor,
  allTabVisible,
  wallTabVisible,
  showThreadsTab,
  canViewAchievements,
  canViewThreads,
  canViewGifts,
  canViewSubscriptions,
  showProfileWall,
  allowWallPostsFromOthers,
  wallHiddenFromViewer,
  privateProfile,
  wallRefreshKey,
  wallCreateOpen,
  onWallCreateOpenChange,
  trophies,
  trophiesLoaded,
  giftCatalog,
  onGiftSent,
}: ProfileTabsProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // ── Tab scrubbing ────────────────────────────────────────────────────────
  // Grab the active tab and drag: the underline is pulled from under the
  // finger to the nearest tab centre, springs across when the pointer crosses a
  // midpoint, and the tab it lands on opens mid-gesture. Pointer capture keeps
  // the drag alive across tab switches.
  const scrubRowRef = useRef<HTMLDivElement | null>(null);
  const scrubActiveRef = useRef(false);
  const scrubKeyRef = useRef<ProfileTab | null>(null);
  const scrubMovedRef = useRef(false);
  const scrubStartXRef = useRef(0);
  const scrubInitialRef = useRef<{ x: number; w: number } | null>(null);
  const [scrubKey, setScrubKey] = useState<ProfileTab | null>(null);

  const startScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-no-scrub]")) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tab-key]");
    if (!target) return;
    const key = target.dataset.tabKey as ProfileTab | undefined;
    if (!key || key !== activeTab) return;
    scrubInitialRef.current = {
      x: target.offsetLeft + 8,
      w: Math.max(0, target.offsetWidth - 16),
    };
    scrubStartXRef.current = event.clientX;
    scrubActiveRef.current = true;
    scrubMovedRef.current = false;
    scrubKeyRef.current = key;
    setScrubKey(key);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubActiveRef.current) return;
    if (Math.abs(event.clientX - scrubStartXRef.current) > 4) scrubMovedRef.current = true;
    const row = event.currentTarget;
    const pointerX = event.clientX - row.getBoundingClientRect().left;
    let bestKey: ProfileTab | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const el of Array.from(row.querySelectorAll<HTMLElement>("[data-tab-key]"))) {
      const key = el.dataset.tabKey as ProfileTab | undefined;
      if (!key) continue;
      const distance = Math.abs(pointerX - (el.offsetLeft + el.offsetWidth / 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }
    if (bestKey && bestKey !== scrubKeyRef.current) {
      scrubKeyRef.current = bestKey;
      setScrubKey(bestKey);
      // Switch content without the tab-click scroll snap: the drag keeps going
      // and the page must not jump under the finger.
      onTabChange(bestKey);
    }
  };

  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubActiveRef.current) return;
    scrubActiveRef.current = false;
    scrubKeyRef.current = null;
    setScrubKey(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleScrubClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!scrubMovedRef.current) return;
    scrubMovedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Warm the lazy tab-body chunks as soon as the profile mounts, so opening a
  // tab swaps its data in fully instead of popping the card/panel in a beat
  // after the (already-loaded) list.
  useEffect(() => {
    void import("./ProfileThreadsTab");
    void import("./ProfileAllTab");
    void import("@/components/GiftsTab");
    void import("@/components/SubscriptionsPanel");
  }, []);

  // Content switches (tabs, album pick) swap the body, so the destination is
  // positioned at the tab bar: its document offset is captured at click time
  // (everything above the bar — profile header/stats/bio — never changes, so
  // the offset is stable across tabs) and the viewport snaps there once the
  // new content rendered. That puts the bar at the top of the viewport with
  // the new tab's content starting right under it. The snap is skipped when
  // the user was still above the bar (page-top zone): there the content just
  // swaps in place.
  const stickyBarRef = useRef<HTMLDivElement | null>(null);
  const tabBodyWrapRef = useRef<HTMLDivElement | null>(null);
  const barSnapTargetRef = useRef<number | null>(null);

  // ── Glass-on-stick ───────────────────────────────────────────────────────
  // The tab bar pours glass in from the top the instant it pins under the app
  // header, and pours it back out when it releases (see .profile-tabbar--stuck
  // in index.css). "Stuck" is exactly when the bar's top has reached its own
  // sticky offset, i.e. its computed `top` (which follows --app-header-pad as
  // the header hides/shows), so no extra geometry bookkeeping is needed.
  const [barStuck, setBarStuck] = useState(false);

  // ── Delayed pin ──────────────────────────────────────────────────────────
  // The bar is always sticky, but a negative offset cancels that while it is
  // still arriving: it keeps scrolling under the header exactly like the rest
  // of the page until ~65% of it is swallowed. At that point the offset springs
  // back to zero and the bar pops out into its pinned place. Once pinned there
  // is no per-scroll work at all — CSS sticky holds it, so it cannot jitter
  // against the scroll.
  const pinY = useMotionValue(0);
  const pinAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const pinnedRef = useRef(false);
  const bodyMarginRef = useRef(0);

  useEffect(() => () => pinAnimRef.current?.stop(), []);

  useEffect(() => {
    const bar = stickyBarRef.current;
    if (!bar) return;
    const bodyEl = tabBodyWrapRef.current;
    if (bodyEl) bodyMarginRef.current = parseFloat(getComputedStyle(bodyEl).marginTop) || 0;

    const update = () => {
      // Read the offset straight from the inline custom property AppLayout keeps
      // in sync: cheaper than getComputedStyle (no style recalc) and identical.
      const pad =
        parseFloat(document.documentElement.style.getPropertyValue("--app-header-pad")) || 0;
      const rect = bar.getBoundingClientRect();
      const h = rect.height;
      // The bar is sticky and translated, so its own rect cannot tell where the
      // flow put it. The non-sticky body wrapper directly follows the bar's
      // layout box, so (body top − its margin − bar height) is the honest
      // position the page has scrolled to.
      const body = tabBodyWrapRef.current;
      const flowTop = body
        ? body.getBoundingClientRect().top - bodyMarginRef.current - h
        : rect.top - pinY.get();

      if (reduceMotion) {
        if (!pinnedRef.current && flowTop <= pad + 1) {
          pinnedRef.current = true;
          setBarStuck(true);
          pinY.set(0);
        } else if (pinnedRef.current && flowTop > pad + 8) {
          pinnedRef.current = false;
          setBarStuck(false);
        }
        return;
      }

      if (!pinnedRef.current) {
        if (flowTop <= pad - h * 0.65) {
          // ~65% of the bar is gone under the header: let go and pop out.
          pinnedRef.current = true;
          setBarStuck(true);
          pinAnimRef.current?.stop();
          pinY.set(-h * 0.65);
          pinAnimRef.current = animate(pinY, 0, springFor("eject", reduceMotion));
          return;
        }
        // Still arriving: cancel the CSS sticky so the bar keeps scrolling
        // under the header with the page. Zero once it is below the header.
        pinY.set(Math.max(-h * 0.65, Math.min(0, flowTop - pad)));
        return;
      }

      // Pinned: CSS sticky holds it with zero per-scroll work. Release once the
      // flow has carried the bar back below the header — at that point its
      // offset is already zero, so nothing moves.
      if (flowTop >= pad + 8) {
        pinnedRef.current = false;
        setBarStuck(false);
        pinAnimRef.current?.stop();
        pinY.set(0);
      }
    };

    // No rAF throttling on purpose: rAF is paused in a background/occluded tab,
    // which would leave the state stale exactly when content settles off-screen.
    // The work is one cheap rect read plus a guarded state write, and scroll
    // events already arrive at frame cadence.
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // A tab that was hidden while the page settled can come back with the bar
    // already pinned; refresh once on the way in (no scroll event fires then).
    document.addEventListener("visibilitychange", update);
    // Content above the bar (bio, stats, async posts) can change height without
    // a scroll event, which would otherwise leave the state stale.
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    // The app header slides away on scroll and writes --app-header-pad frame by
    // frame; while the bar is pinned it must follow that edge even when no
    // scroll events arrive.
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [pinY, reduceMotion]);

  const snapToBar = () => {
    const bar = stickyBarRef.current;
    const body = tabBodyWrapRef.current;
    if (!bar || !body) return;
    // A stuck sticky element reports its PINNED position through both
    // getBoundingClientRect() (top ≈ 0) and offsetTop (≈ scrollY), so neither
    // can locate it in the document flow while the bar is stuck. The body
    // wrapper is never sticky — its document top is stable — and the bar
    // directly precedes it, so the bar's natural top is the wrapper's top
    // minus the bar's height.
    const barHeight = bar.getBoundingClientRect().height;
    const bodyDocTop = body.getBoundingClientRect().top + window.scrollY;
    const barDocTop = bodyDocTop - barHeight;
    if (window.scrollY >= barDocTop) barSnapTargetRef.current = barDocTop;
  };

  const switchTab = (tab: ProfileTab) => {
    if (tab !== activeTab) {
      snapToBar();
      onTabChange(tab);
    }
  };

  // ── Profile albums (wall tab) ────────────────────────────────────────────
  // Albums are collections of wall posts; visibility follows the wall. The
  // albums list loads when the wall tab is open; management is owner-only.
  const {
    albums,
    loadAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addPosts,
    removePost,
  } = useProfileAlbums(userId, activeTab === "wall" && wallTabVisible);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");

  const showAlbumsRow = activeTab === "wall" && wallTabVisible && (albumsOpen || selectedAlbumId !== null);

  // The chevron next to «Стена» toggles the album row; closing it also resets
  // the selection back to «Все» so the wall view never hides the selector.
  const toggleAlbumsRow = () => {
    if (albumsOpen || selectedAlbumId !== null) {
      snapToBar();
      setAlbumsOpen(false);
      setSelectedAlbumId(null);
    } else {
      setAlbumsOpen(true);
    }
  };

  const submitCreateAlbum = async () => {
    const name = newAlbumName.trim();
    if (!name) {
      toast.error(t("profile.albumNameRequired"));
      return;
    }
    try {
      const created = await createAlbum(name);
      setNewAlbumName("");
      setCreatingAlbum(false);
      setAlbumsOpen(true);
      if (created) setSelectedAlbumId(created.id);
      toast.success(t("profile.albumCreated"));
    } catch (error) {
      console.error("Error creating album:", error);
      toast.error(t("profile.albumCreateError"));
    }
  };

  const handleRenameAlbum = async (albumId: string, name: string) => {
    await renameAlbum(albumId, name);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    await deleteAlbum(albumId);
    if (selectedAlbumId === albumId) setSelectedAlbumId(null);
  };

  // Keep the app header in its current hide/show state while the swapped
  // content settles: the snap's synthetic scroll would otherwise read as a
  // user scroll and pop the header back in, dropping the pinned tab bar.
  // Then snap to the bar (when the user was in the pinned zone) so the new
  // tab opens with the bar at the top and its content from the very top.
  useLayoutEffect(() => {
    window.dispatchEvent(new Event("gomo6:profile-content-switch"));
    const target = barSnapTargetRef.current;
    if (target == null) return;
    barSnapTargetRef.current = null;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(target, max));
  }, [activeTab, selectedAlbumId]);

  // Minimalist row items — same visual language as the tabs above: icon +
  // label, active one tinted with the primary color, no pills/borders.
  const albumRowClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
    }`;

  const selectedAlbum = selectedAlbumId ? albums.find((a) => a.id === selectedAlbumId) || null : null;

  // ── Directed content swap ────────────────────────────────────────────────
  // The tabs are an ordered row, so switching one has a spatial direction: the
  // new body arrives from the side the bar travelled towards. The offset is
  // deliberately small (14px) — enough to read as «this came from there»
  // without the content sliding across the screen. The body is keyed by tab +
  // album, so a swap mounts a fresh motion element and its `initial` runs.
  const bodyKey = `${activeTab}:${selectedAlbumId ?? "all"}`;
  // The previous position is kept in a ref and updated AFTER the render that
  // mounts the new body, so that render still knows which way it travelled.
  const previousPositionRef = useRef(activeTab);
  const bodyDirection = travelDirection(TAB_ORDER.indexOf(previousPositionRef.current), TAB_ORDER.indexOf(activeTab));
  // The first paint comes from the page-level enter animation; don't stack a
  // second one on top of it.
  const hasPaintedRef = useRef(false);

  useEffect(() => {
    hasPaintedRef.current = true;
  }, []);

  useEffect(() => {
    previousPositionRef.current = activeTab;
  }, [activeTab]);

  const bodyEnter = (() => {
    // First paint comes from the page-level enter; a swap is a dimensional
    // morph: the new body unfolds from the tab bar (origin at the top edge),
    // travelling a hint in the direction the bar moved.
    if (!hasPaintedRef.current || reduceMotion) {
      return { initial: false as const, animate: { opacity: 1, x: 0, scale: 1 } };
    }
    return {
      initial: { opacity: 0, x: bodyDirection * SPATIAL_OFFSET.tab, scale: 0.97 },
      animate: { opacity: 1, x: 0, scale: 1 },
    };
  })();

  return (
    <>
      {/* Sticky bar: pins under the app header and follows its hide/show slide
          (offset comes from --app-header-pad, kept in sync by AppLayout). */}
      <motion.div
        ref={stickyBarRef}
        className={`profile-tabbar sticky z-30 ${panel ? "profile-tabbar--panel overflow-hidden border border-border/60" : "border-b border-border"}${barStuck && !panel ? " profile-tabbar--stuck" : ""}`}
        style={{ top: "var(--app-header-pad, 0px)", y: pinY }}
      >
        {/* One background layer behind the content: an opaque strip while the
            bar travels with the page, frosted once it pins. It sits on the bar
            itself (not in the scroller below) so a horizontal tab scroll can't
            drag it sideways, and it is a child element rather than the sticky
            bar itself because Chrome drops a backdrop-filter sitting on a
            sticky element while a Radix portal is open — which used to make the
            whole bar vanish. The switch is instant on purpose: the bar pins over
            the profile header (a flat block of colour), so a wipe would not be
            visible there and would only add per-frame cost. */}
        <span className="profile-tabbar__bg" aria-hidden="true" />
        <div className="relative z-10 overflow-x-auto">
        <div
          ref={scrubRowRef}
          className="relative flex gap-1 min-w-max px-1.5 py-1"
          onPointerDown={startScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onClickCapture={handleScrubClickCapture}
        >
          {allTabVisible && (
            <TabButton
              tab={{ key: "all", icon: Layers, label: t("profile.allContent") }}
              active={activeTab === 'all'}
              onClick={() => switchTab('all')}
              hideIndicator={!!scrubKey}
            />
          )}
          {wallTabVisible && (
            <WallTabButton
              active={activeTab === 'wall'}
              label={t("profile.wall")}
              onTabClick={() => switchTab('wall')}
              showChevron={activeTab === 'wall' && (albums.length > 0 || isOwnProfile)}
              chevronOpen={albumsOpen || selectedAlbumId !== null}
              onChevronClick={toggleAlbumsRow}
              chevronTitle={t("profile.albums")}
              hideIndicator={!!scrubKey}
            />
          )}
          {canViewAchievements && (
            <TabButton
              tab={{
                key: "achievements",
                icon: Trophy,
                label: t("profile.achievements"),
              }}
              active={activeTab === 'achievements'}
              onClick={() => switchTab('achievements')}
              hideIndicator={!!scrubKey}
            />
          )}
          {showThreadsTab && canViewThreads && (
            <TabButton
              tab={{ key: "threads", icon: MessageSquareText, label: t("profile.threads") }}
              active={activeTab === 'threads'}
              onClick={() => switchTab('threads')}
              hideIndicator={!!scrubKey}
            />
          )}
          {canViewGifts && (
            <TabButton
              tab={{
                key: "gifts",
                icon: Gift,
                label: t("profile.gifts"),
              }}
              active={activeTab === 'gifts'}
              onClick={() => switchTab('gifts')}
              hideIndicator={!!scrubKey}
            />
          )}
          {canViewSubscriptions && (
            <SubscribersTabButton
              activeTab={activeTab}
              onClick={() => switchTab('subscribers')}
              hideIndicator={!!scrubKey}
            />
          )}
          {scrubKey && scrubInitialRef.current && (
            <ScrubIndicator
              rowRef={scrubRowRef}
              tabKey={scrubKey}
              initial={scrubInitialRef.current}
            />
          )}
        </div>

        {/* Album row: «Все» + album chips + create. Drops below the tab
            buttons inside the sticky bar when opened — the row unfolds from
            the bar itself (height + blur morph), not by popping into place. */}
        <AnimatePresence initial={false}>
        {showAlbumsRow && (
          <motion.div
            key="albums-row"
            initial={reduceMotion ? false : { height: 0, opacity: 0, filter: "blur(6px)" }}
            animate={{ height: "auto", opacity: 1, filter: "blur(0px)" }}
            exit={{ height: 0, opacity: 0, filter: "blur(4px)" }}
            transition={morphTransition(reduceMotion, springFor("reveal", reduceMotion))}
            style={morphOrigin({ y: 0 })}
            className="overflow-hidden"
          >
          <div className="flex flex-wrap items-center gap-0.5 border-t border-border/60 px-1 pb-1.5 pt-0.5">
            <button
              onClick={() => {
                snapToBar();
                setSelectedAlbumId(null);
              }}
              className={albumRowClass(selectedAlbumId === null)}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("profile.allPosts")}
            </button>
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => {
                  snapToBar();
                  setSelectedAlbumId(album.id);
                }}
                className={albumRowClass(selectedAlbumId === album.id)}
              >
                <span className="max-w-40 truncate">{album.name}</span>
              </button>
            ))}
            {isOwnProfile && !creatingAlbum && (
              <button
                onClick={() => setCreatingAlbum(true)}
                className="inline-flex items-center rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-primary"
                title={t("profile.createAlbum")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          </motion.div>
        )}
        </AnimatePresence>
        </div>
      </motion.div>

      {/* Create-album dialog — modal so it works on phones too (full-width
          sheet instead of the cramped inline input row). */}
      <Dialog open={creatingAlbum} onOpenChange={setCreatingAlbum}>
        <DialogContent className="gap-5 overflow-hidden rounded-2xl border-border/70 bg-card p-5 shadow-2xl sm:max-w-md sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">{t("profile.createAlbum")}</DialogTitle>
            <DialogDescription>
              {t("profile.albumCreateHint")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreateAlbum();
            }}
            className="space-y-5"
          >
            <input
              autoFocus
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={t("profile.albumNamePlaceholder")}
              maxLength={80}
              className="h-12 w-full rounded-xl border border-border/60 bg-muted/30 px-4 text-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-background focus:ring-4 focus:ring-primary/10"
            />
            <DialogFooter className="gap-2 sm:gap-2.5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreatingAlbum(false);
                  setNewAlbumName("");
                }}
                className="rounded-lg px-5 hover:bg-muted"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                className="rounded-lg px-6 shadow-sm"
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tab Content — one always-mounted wrapper. Short tabs hold a
          viewport-tall minimum height (min-h-[100dvh]) so the tab bar can
          always pin at the top after a switch; switching positions the view
          at the bar (see snapToBar), so the new tab opens with the bar at
          the top and its content visible from the very start. An open album
          shows the album view instead of the full wall. */}
      <div
        ref={tabBodyWrapRef}
        className={`min-h-[100dvh]${contentPanel ? " surface-panel mt-3 rounded-xl border border-border/60 p-3 shadow-sm" : ""}`}
      >
        <motion.div
          key={bodyKey}
          initial={bodyEnter.initial}
          animate={bodyEnter.animate}
          transition={morphTransition(reduceMotion)}
          style={morphOrigin({ y: 0 })}
        >
        {activeTab === 'all' && allTabVisible && (
          <Suspense fallback={null}>
            <ProfileAllTab
              key={userId}
              profileUserId={userId}
              profileUsername={profile.username}
              includeThreads={showThreadsTab && canViewThreads}
              includeWall={wallTabVisible && !wallHiddenFromViewer}
              currentUserId={currentUser?.id || null}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
            />
          </Suspense>
        )}

        {activeTab === 'wall' && wallTabVisible && (
          <div>
          {selectedAlbum ? (
            <ProfileAlbumView
              album={selectedAlbum}
              profileUserId={userId}
              currentUserId={currentUser?.id || null}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              isOwnProfile={isOwnProfile}
              onAddPosts={(postIds) => addPosts(selectedAlbum.id, postIds)}
              onRemovePost={(postId) => removePost(selectedAlbum.id, postId)}
              onRenameAlbum={(name) => handleRenameAlbum(selectedAlbum.id, name)}
              onDeleteAlbum={() => handleDeleteAlbum(selectedAlbum.id)}
              onAlbumPostsChanged={loadAlbums}
            />
          ) : (
            <ProfileWall
              profileUserId={userId}
              currentUserId={currentUser?.id || null}
              currentUsername={currentUsername}
              canPost={currentUser?.id === userId || allowWallPostsFromOthers}
              showWall={showProfileWall}
              refreshKey={wallRefreshKey}
              wallHidden={wallHiddenFromViewer}
              privateProfile={privateProfile}
              createOpen={wallCreateOpen}
              onCreateOpenChange={onWallCreateOpenChange}
            />
          )}
        </div>
      )}

      {activeTab === 'achievements' && canViewAchievements && trophiesLoaded && (
        <div>
          {trophies.length === 0 ? (
            <p className="text-muted-foreground">{t("profile.noAchievements")}</p>
          ) : (
            <div className="space-y-6">
              {/* Trophy case — the rarest hand-granted awards. Quest
                  milestones live on the quests page, linked below. */}
              <TrophyShowcase trophies={trophies} />

              {/* Link to the quests page */}
              <div className="pt-2">
                <Link
                  to={`/achievements/${userId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors group/link"
                >
                  <Trophy className="w-4 h-4 group-hover/link:text-amber-400 transition-colors" />
                  {t("achievements.goToQuests")}
                  <span className="text-xs text-muted-foreground/50">
                    ({trophies.length})
                  </span>
                  <span className="ml-1 group-hover/link:translate-x-0.5 transition-transform">→</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'threads' && showThreadsTab && canViewThreads && (
        <Suspense fallback={null}>
          <ProfileThreadsTab
            key={userId}
            userId={userId}
            currentUser={currentUser}
            currentUsername={currentUsername}
            currentUserColor={currentUserColor}
          />
        </Suspense>
      )}

      {activeTab === 'gifts' && canViewGifts && (
        <div>
          <Suspense fallback={null}>
            <GiftsTab
              userId={userId}
              isOwnProfile={isOwnProfile}
              giftCatalog={giftCatalog}
              recipientUsername={profile.username}
              onGiftSent={onGiftSent}
            />
          </Suspense>
        </div>
      )}

      {activeTab === 'subscribers' && canViewSubscriptions && (
        <div>
          <Suspense fallback={null}>
            <SubscriptionsPanel userId={userId} />
          </Suspense>
        </div>
      )}
        </motion.div>
      </div>
    </>
  );
}