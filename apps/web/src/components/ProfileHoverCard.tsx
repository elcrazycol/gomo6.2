import { useState, cloneElement, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/integrations/api/compat";
import { User, Droplets } from "lucide-react";
import { format } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { safeDate } from "@/utils/safeDate";
import { getProfileCustomization, parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";
import { NicknameEmoji } from "./NicknameEmoji";
import { processProfileBio } from "@/utils/profileBio";
import { pluralRu } from "@/utils/pluralRu";
import { storageUrl } from "@/utils/storage";
import { OnlineStatus } from "./OnlineStatus";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

interface ProfileHoverCardProps {
  userId: string;
  children: React.ReactNode;
  disabled?: boolean;
  showDrops?: boolean;
}

const getColorClass = (color: string): string => {
  const colorClasses: Record<string, string> = {
    purple: "text-purple-500",
    gold: "text-yellow-500",
    orange: "text-orange-500",
    red: "text-red-500",
    blue: "text-blue-500",
    green: "text-green-500",
    yellow: "text-yellow-400",
    cyan: "text-cyan-500",
  };
  return colorClasses[color] || "text-foreground";
};

// Fetch profile data with caching
const fetchProfileData = async (userId: string) => {
  const [profileResult, achievementsResult, customization, placeholdersResult] = await Promise.all([
    api.from("profiles").select("*").eq("id", userId).single(),
    api.from("user_achievements").select(`
      achievement_id,
      achievements (
        reward_type,
        reward_value
      )
    `).eq("user_id", userId),
    getProfileCustomization(userId),
    api.from("user_placeholders").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const profile = profileResult.data as Record<string, unknown> | null;
  const achievements = achievementsResult.data as unknown as Array<Record<string, unknown>> | null;
  const placeholders = placeholdersResult.data as Record<string, unknown> | null;

  if (!profile) return null;

  // Determine username color
  let usernameColor = "";
  if (achievements) {
    const colorRewards = achievements
      .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === "username_color")
      .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

    const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
    for (const p of priority) {
      if ((colorRewards as unknown[]).includes(p)) {
        usernameColor = p as string;
        break;
      }
    }
  }

  return {
    profile,
    avatarUrl: storageUrl("post-images", profile.avatar_url as string | null),
    usernameColor,
    customization,
    placeholders,
  };
};

export const ProfileHoverCard = ({ userId, children, disabled = false, showDrops = false }: ProfileHoverCardProps) => {
  const dateLocale = useDateLocale();
  const [showCard, setShowCard] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Use React Query for caching - only fetch when card is shown
  // Profiles change rarely (avatar/name/bio); is_online comes via realtime
  // (useRealtimeStatus) so a 5-minute staleTime is safe and kills the repeated
  // hover refetches that used to fire 4 requests per card every 30s.
  // Profile edits still invalidate instantly via 'profile-cache:invalidate'.
  const { data } = useQuery({
    queryKey: ['profile-hover', userId],
    queryFn: () => fetchProfileData(userId),
    enabled: showCard && !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // When the viewed user edits their profile (avatar/name/bio...), the rest of
  // the app broadcasts 'profile-cache:invalidate'. Drop our react-query cache
  // so the next hover shows fresh data instantly instead of up to 30s stale.
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["profile-hover"] });
    };
    window.addEventListener("profile-cache:invalidate", handler);
    return () => window.removeEventListener("profile-cache:invalidate", handler);
  }, [queryClient]);

  // Fetch drops only when card is shown and showDrops is enabled
  const { data: dropsData } = useQuery({
    queryKey: ['user-drops', userId],
    queryFn: async () => {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return null;
      const res = await fetch(`/api/v1/user/drops?user_id=${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) return json.data as { drops: number };
      return null;
    },
    enabled: showCard && showDrops && !!userId,
    staleTime: 30 * 1000,
  });

  // Use shared hook for real-time status updates
  useUserRealtimeStatus(userId);

  // Detect viewport overflow and flip card to left side if needed
  const checkOverflow = useCallback(() => {
    if (!cardRef.current || !wrapperRef.current) return;
    const cardRect = cardRef.current.getBoundingClientRect();
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const rightEdge = wrapperRect.left + cardRect.width;
    const overflow = rightEdge > window.innerWidth - 8;
    setFlipLeft(overflow);
  }, []);

  useEffect(() => {
    if (showCard && data) {
      requestAnimationFrame(() => checkOverflow());
    }
  }, [showCard, data, checkOverflow]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearTimeout(openTimeoutRef.current);
      clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const handleTriggerMouseEnter = useCallback(() => {
    clearTimeout(closeTimeoutRef.current);
    openTimeoutRef.current = setTimeout(() => setShowCard(true), 200);
  }, []);

  const handleTriggerMouseLeave = useCallback(() => {
    clearTimeout(openTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setShowCard(false), 100);
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    clearTimeout(closeTimeoutRef.current);
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    clearTimeout(openTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setShowCard(false), 100);
  }, []);

  const childrenWithHover = cloneElement(children as React.ReactElement, disabled ? {} : {
    onMouseEnter: handleTriggerMouseEnter,
    onMouseLeave: handleTriggerMouseLeave,
  });

  if (disabled || !showCard || !data) {
    return (
      <div className="relative">
        {childrenWithHover}
      </div>
    );
  }

  const { profile, avatarUrl, usernameColor, customization, placeholders } = data;
  const p = profile as Record<string, unknown>;

  // Profile background (avatar + background) — shown as a small banner strip.
  const profileBackgroundUrl = (p.background_url as string | null) || null;
  const bgUrl = profileBackgroundUrl ? storageUrl("post-images", profileBackgroundUrl) || profileBackgroundUrl : null;

  const usernameStyle = customization?.username_css
    ? parseCssToStyle(customization.username_css)
    : {};

  const badgeStyle = customization?.profile_badge_css
    ? parseCssToStyle(customization.profile_badge_css)
    : {};

  const usernameClassName = customization?.username_css
    ? "font-semibold truncate"
    : `font-semibold truncate ${usernameColor ? getColorClass(usernameColor) : "text-foreground"}`;

  return (
    <div ref={wrapperRef} className="relative">
      {childrenWithHover}

      {/* Hover Card — flips to left side when near right viewport edge */}
      <div
        ref={cardRef}
        className={`absolute top-full mt-1 z-50 ${flipLeft ? 'right-0' : 'left-0'}`}
        onMouseEnter={handleCardMouseEnter}
        onMouseLeave={handleCardMouseLeave}
      >
        <div className="bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-lg min-w-[280px] max-w-[320px] overflow-hidden">
          {bgUrl && (
            <div className="h-20 w-full relative">
              <img src={bgUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/25" />
            </div>
          )}
          <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-muted-foreground" />
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className={usernameClassName} style={usernameStyle}>
                  {(p.display_name as string)?.trim() || (p.username as string)}
                </span>
                {p.nickname_emoji_id && <NicknameEmoji emojiId={p.nickname_emoji_id as string} />}
                {customization?.profile_badge_text && (
                  <span
                    className="px-1.5 py-0.5 rounded text-xs font-medium"
                    style={badgeStyle}
                  >
                    {customization.profile_badge_text}
                  </span>
                )}
                <AdminBadge userId={userId} />
              </div>
              <div className="text-sm text-muted-foreground">
                @{p.username as string}
              </div>
              <div className="text-sm text-muted-foreground">
                ID: {p.id ? String(p.id).slice(0, 8) : 'N/A'} {p.account_number ? `(${p.account_number})` : ''}
              </div>
              <OnlineStatus
                userId={userId}
                isOnline={p.is_online as boolean}
                lastSeen={p.last_seen as string | null}
                className="mt-1"
              />
              {showDrops && dropsData && (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('navigate-to', { detail: '/wallet' }));
                  }}
                  className="flex items-center gap-1 mt-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  <Droplets className="w-4 h-4" />
                  <span>{dropsData.drops} {formatDropsLabel(dropsData.drops)}</span>
                </button>
              )}
              {(() => {
                // Use custom placeholders if set, otherwise use default
                if (placeholders?.use_custom && placeholders?.custom_placeholder) {
                  return (
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      {processProfileBio(placeholders.custom_placeholder as string)}
                    </div>
                  );
                }

                // Use preset placeholders if set
                const placeholder1 = (placeholders?.placeholder_1 as string) || 'bio';
                const placeholder2 = (placeholders?.placeholder_2 as string) || 'created_at';
                const placeholder3 = (placeholders?.placeholder_3 as string) || 'post_count';

                const renderPlaceholder = (value: string) => {
                  switch (value) {
                    case 'bio':
                      return p.bio ? processProfileBio(p.bio as string) : null;
                    case 'created_at':
                      return p.created_at ? format(safeDate(p.created_at as string), "dd.MM.yyyy", { locale: dateLocale }) : null;
                    case 'post_count': {
                      // Unified «записи» = треды + записи стены (ключ сохранён
                      // для обратной совместимости с user_placeholders).
                      const records = Number(p.thread_count || 0) + Number(p.wall_post_count || 0);
                      return pluralRu(records, 'запись', 'записи', 'записей');
                    }
                    case 'comment_count':
                      return p.comment_count != null ? pluralRu(Number(p.comment_count), 'комментарий', 'комментария', 'комментариев') : null;
                    case 'thread_count':
                      return p.thread_count != null ? `${p.thread_count} ${p.thread_count === 1 ? 'тред' : (p.thread_count as number) < 5 ? 'треда' : 'тредов'}` : null;
                    case 'account_number':
                      return p.account_number ? `#${p.account_number}` : null;
                    case 'id':
                      return p.id ? String(p.id).slice(0, 8) : null;
                    default:
                      return null;
                  }
                };

                const parts: React.ReactNode[] = [];
                const values = [placeholder1, placeholder2, placeholder3];
                
                values.forEach((value, index) => {
                  const rendered = renderPlaceholder(value);
                  if (rendered) {
                    if (parts.length > 0) {
                      parts.push(<span key={`sep-${index}`}> | </span>);
                    }
                    parts.push(<span key={value}>{rendered}</span>);
                  }
                });

                return parts.length > 0 ? (
                  <div className="text-xs text-muted-foreground/70 mt-1 flex items-center gap-1 flex-wrap">
                    {parts}
                  </div>
                ) : null;
              })()}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
