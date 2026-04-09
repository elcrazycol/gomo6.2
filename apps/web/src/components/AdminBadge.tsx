import { useEffect, useState, memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProfileCache } from "@/contexts/ProfileCacheContext";

interface AdminBadgeProps {
  userId: string;
}

const AdminIconSVG = () => (
  <svg
    version="1.0"
    xmlns="http://www.w3.org/2000/svg"
    width="1020.000000pt"
    height="1280.000000pt"
    viewBox="0 0 1020.000000 1280.000000"
    preserveAspectRatio="xMidYMid meet"
    className="w-4 h-4"
    style={{ fill: 'currentColor' }}
  >
    <g transform="translate(0.000000,1280.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
      <path d="M3328 12785 c-664 -108 -1088 -776 -902 -1422 101 -350 391 -650 732 -757 296 -93 575 -72 847 64 226 113 392 278 505 505 82 165 110 276 117 465 4 123 2 161 -17 250 -92 451 -428 790 -875 885 -108 23 -298 28 -407 10z"/>
      <path d="M3435 10334 c-11 -2 -45 -9 -75 -15 -194 -38 -383 -142 -534 -292 -199 -197 -307 -440 -322 -722 -5 -89 4 -266 66 -1330 6 -93 37 -638 70 -1210 48 -828 64 -1059 80 -1133 71 -335 297 -616 617 -767 77 -37 210 -79 308 -97 42 -8 628 -12 1955 -15 l1895 -4 131 -227 c1009 -1750 1375 -2380 1403 -2415 92 -111 233 -198 378 -232 102 -25 262 -17 360 18 334 116 510 486 395 830 -23 68 -221 416 -992 1748 -530 915 -980 1689 -1000 1719 -83 122 -225 224 -375 267 -56 17 -164 18 -1511 21 l-1451 2 -6 173 c-4 94 -10 286 -14 425 l-6 252 1044 0 c901 0 1053 2 1104 15 266 68 437 315 396 573 -28 185 -147 329 -334 405 -52 22 -54 22 -1162 27 l-1110 5 -8 105 c-35 487 -70 907 -78 965 -23 145 -92 317 -182 450 -99 146 -299 310 -461 378 -149 63 -227 79 -401 83 -88 1 -169 1 -180 -2z"/>
      <path d="M1880 7729 c-527 -357 -957 -808 -1283 -1346 -564 -930 -737 -2072 -477 -3148 253 -1044 888 -1944 1790 -2540 1026 -677 2306 -870 3489 -528 1011 292 1897 976 2444 1887 108 181 240 444 232 464 -11 31 -580 1012 -586 1012 -4 0 -12 -28 -19 -62 -18 -95 -84 -308 -136 -443 -359 -924 -1102 -1640 -2034 -1960 -650 -222 -1370 -234 -2044 -34 -715 213 -1381 707 -1804 1339 -289 433 -462 892 -538 1430 -26 178 -26 683 -1 855 36 247 83 444 153 646 174 499 439 918 825 1300 l167 167 -29 498 c-16 275 -29 507 -29 517 0 9 -3 17 -7 17 -5 0 -55 -32 -113 -71z"/>
    </g>
  </svg>
);

export const AdminBadge = memo(({ userId }: AdminBadgeProps) => {
  const { getProfile, loadProfile } = useProfileCache();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const cached = getProfile(userId);
    if (cached) {
      setIsAdmin(cached.isAdmin);
      return;
    }

    loadProfile(userId).then(profile => setIsAdmin(profile.isAdmin));
  }, [userId, getProfile, loadProfile]);

  if (!isAdmin) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center text-primary cursor-help">
            <AdminIconSVG />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>администратор gomo6</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

AdminBadge.displayName = 'AdminBadge';
