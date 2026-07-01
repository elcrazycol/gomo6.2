import { User as UserIcon } from "lucide-react";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { Card } from "@/components/ui/card";

interface ProfilePreviewProps {
  username: string;
  avatarUrl: string | null;
  usernameCss: string;
  iconSvg: string;
  iconFill: string;
  iconStroke: string;
  badgeText: string;
  badgeCss: string;
}

export function ProfilePreview({
  username,
  avatarUrl,
  usernameCss,
  iconSvg,
  iconFill,
  iconStroke,
  badgeText,
  badgeCss,
}: ProfilePreviewProps) {
  const usernameStyle = parseCssToStyle(usernameCss);
  const badgeStyle = parseCssToStyle(badgeCss);

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground">Предпросмотр</h3>

      {/* Profile-like card */}
      <div className="bg-post-header border border-border rounded-lg p-4">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-8 h-8 text-muted-foreground" />
            )}
          </div>

          {/* User info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {iconSvg && (
                <span
                  className="inline-flex items-center justify-center shrink-0"
                  dangerouslySetInnerHTML={{ __html: iconSvg }}
                  style={{
                    fill: iconFill,
                    stroke: iconStroke,
                    width: '1em',
                    height: '1em',
                    maxHeight: '20px',
                    maxWidth: '20px',
                  }}
                />
              )}
              <span className="text-xl font-bold truncate" style={usernameStyle}>
                {username || "Ваш никнейм"}
              </span>
              {badgeText && (
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium shrink-0"
                  style={badgeStyle}
                >
                  {badgeText}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Профиль</p>
          </div>
        </div>
      </div>

      {/* Post-like preview */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap mb-1">
              {iconSvg && (
                <span
                  className="inline-flex items-center justify-center shrink-0"
                  dangerouslySetInnerHTML={{ __html: iconSvg }}
                  style={{
                    fill: iconFill,
                    stroke: iconStroke,
                    width: '1em',
                    height: '1em',
                    maxHeight: '16px',
                    maxWidth: '16px',
                  }}
                />
              )}
              <span className="text-sm font-bold truncate" style={usernameStyle}>
                {username || "Ваш никнейм"}
              </span>
              {badgeText && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                  style={badgeStyle}
                >
                  {badgeText}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">· сейчас</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Пример того, как будет выглядеть ваш никнейм в постах
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
