import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface PentagramLoaderProps {
  size?: "sm" | "md" | "lg" | "full";
  className?: string;
}

export const PentagramLoader = ({ size = "md", className }: PentagramLoaderProps) => {
  const sizeClasses = {
    sm: "w-16 h-16",
    md: "w-32 h-32",
    lg: "w-48 h-48",
    full: "w-64 h-64",
  };

  useEffect(() => {
    // Inject styles if not already present
    if (!document.getElementById('pentagram-loader-styles')) {
      const style = document.createElement('style');
      style.id = 'pentagram-loader-styles';
      style.textContent = `
        .pentagram-loader svg {
          animation: pentagram-pulse 3s infinite ease-in-out;
        }

        .pentagram-path {
          stroke-dasharray: 1200;
          stroke-dashoffset: 1200;
          animation: pentagram-draw 6s infinite cubic-bezier(0.77, 0, 0.175, 1);
          fill: none;
          stroke: hsl(var(--primary));
          stroke-width: 4;
          stroke-linejoin: round;
          stroke-linecap: round;
        }

        @keyframes pentagram-draw {
          0% {
            stroke-dashoffset: 1200;
            stroke-width: 4;
          }
          15% {
            stroke-dashoffset: 600;
            stroke-width: 5;
          }
          20% {
            stroke-dashoffset: 700;
            stroke-width: 4;
          }
          25% {
            stroke-dashoffset: 600;
          }
          30% {
            stroke-dashoffset: 600;
          }
          75% {
            stroke-dashoffset: 0;
            stroke-width: 5;
          }
          90% {
            stroke-width: 4;
          }
          100% {
            stroke-dashoffset: -1200;
            stroke-width: 4;
          }
        }

        @keyframes pentagram-pulse {
          0%, 100% {
            filter: brightness(1) drop-shadow(0 0 15px hsl(var(--primary) / 0.8));
            transform: scale(1) rotate(0deg);
          }
          25% {
            filter: brightness(1.3) drop-shadow(0 0 20px hsl(var(--primary) / 0.9));
          }
          50% {
            filter: brightness(1.8) drop-shadow(0 0 30px hsl(var(--primary) / 1));
            transform: scale(1.1) rotate(-4deg);
          }
          75% {
            filter: brightness(1.3) drop-shadow(0 0 20px hsl(var(--primary) / 0.9));
          }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div className={cn("pentagram-loader", sizeClasses[size])}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          <path
            className="pentagram-path"
            d="M50,95 
              L5,10 
              L95,63 
              L5,63 
              L95,10 
              Z"
          />
        </svg>
      </div>
    </div>
  );
};
