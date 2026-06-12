import { useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";
import { Link } from "react-router-dom";
import { getProfileCustomization, parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UserBadgeProps {
  userId: string | null;
  username: string;
  isAnonymous?: boolean;
  showOutline?: boolean;
  disableLink?: boolean;
  disableHoverCard?: boolean;
  stopPropagationOnClick?: boolean;
  isThreadOpener?: boolean;
  className?: string;
}

export const UserBadge = ({
  userId,
  username,
  isAnonymous,
  showOutline = true,
  disableLink = false,
  disableHoverCard = false,
  stopPropagationOnClick = false,
  isThreadOpener,
  className,
}: UserBadgeProps) => {
  const [color, setColor] = useState<string>("");
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);

  useEffect(() => {
    if (!userId || isAnonymous) return;

    const loadData = async () => {
      // Load achievements for fallback color
      const { data } = await api
        .from("user_achievements")
        .select(`
          achievement_id,
          achievements (
            reward_type,
            reward_value
          )
        `)
        .eq("user_id", userId);

      if (data) {
        const colorRewards = data
          .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === "username_color")
          .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

        const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
        for (const p of priority) {
          if (colorRewards.includes(p)) {
            setColor(p);
            break;
          }
        }
      }

      // Load customization
      const custom = await getProfileCustomization(userId);
      setCustomization(custom);
    };

    loadData();
  }, [userId, isAnonymous]);

  const textSizeClass = showOutline ? "text-base" : "text-xs sm:text-sm";
  const outlineClass = showOutline ? "drop-shadow-[0_0_1px_rgba(255,255,255,0.8)]" : "";

  if (isAnonymous || !userId) {
    return <span className={`font-bold text-quote ${textSizeClass} ${outlineClass} ${className ?? ""}`}>Аноним</span>;
  }

  const colorClasses: Record<string, string> = {
    purple: `text-purple-500 font-bold ${textSizeClass} ${outlineClass}`,
    gold: `text-yellow-500 font-bold ${textSizeClass} ${outlineClass}`,
    orange: `text-orange-500 font-bold ${textSizeClass} ${outlineClass}`,
    red: `text-red-500 font-bold ${textSizeClass} ${outlineClass}`,
    blue: `text-blue-500 font-bold ${textSizeClass} ${outlineClass}`,
    green: `text-green-500 font-bold ${textSizeClass} ${outlineClass}`,
    yellow: `text-yellow-400 font-bold ${textSizeClass} ${outlineClass}`,
    cyan: `text-cyan-500 font-bold ${textSizeClass} ${outlineClass}`,
  };

  // Apply customization CSS if available
  const usernameStyle = customization?.username_css 
    ? parseCssToStyle(customization.username_css)
    : {};

  const badgeStyle = customization?.profile_badge_css
    ? parseCssToStyle(customization.profile_badge_css)
    : {};

  const usernameClassName = customization?.username_css
    ? `font-bold hover:underline ${textSizeClass}`
    : `font-bold hover:underline ${textSizeClass} ${outlineClass} ${color ? colorClasses[color] : "text-quote"}`;

  const usernameContent = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
      <span className={usernameClassName} style={usernameStyle}>
        {username}
      </span>
      {customization?.username_icon_svg && (
        <span
          className="inline-flex items-center justify-center"
          dangerouslySetInnerHTML={{ __html: customization.username_icon_svg }}
          style={{
            fill: customization.username_icon_fill || undefined,
            stroke: customization.username_icon_stroke || undefined,
            width: '1em',
            height: '1em',
              maxHeight: '20px',
              maxWidth: '20px',
          }}
        />
      )}
      {customization?.profile_badge_text && (
        <span
          className="px-2 py-0.5 rounded text-xs font-medium ml-1"
          style={badgeStyle}
        >
          {customization.profile_badge_text}
        </span>
      )}
      {userId && <AdminBadge userId={userId} />}
      {/* Thread Opener Badge */}
      {isThreadOpener && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-primary text-primary-foreground rounded cursor-help">
                TO
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>тредооткрыватель:D</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );

  const badgeContent = disableLink ? (
      {usernameContent}
  ) : (
      <Link
        to={`/profile/${userId}`}
        className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden"
        onClick={stopPropagationOnClick ? (event) => event.stopPropagation() : undefined}
      >
        {usernameContent}
      </Link>
  );

  return className ? (
    <span className={className}>{badgeContent}</span>
  ) : badgeContent;
};
