"use client";

import { useEffect } from "react";

type Props = {
  size?: "sm" | "md" | "lg";
};

export const PentagramLoader = ({ size = "md" }: Props) => {
  const className = size === "sm" ? "loader-sm" : size === "lg" ? "loader-lg" : "loader-md";

  useEffect(() => {
    if (document.getElementById("messenger-pentagram-loader-styles")) return;

    const style = document.createElement("style");
    style.id = "messenger-pentagram-loader-styles";
    style.textContent = `
      .messenger-pentagram svg {
        animation: messenger-pentagram-pulse 3s infinite ease-in-out;
      }

      .messenger-pentagram-path {
        stroke-dasharray: 1200;
        stroke-dashoffset: 1200;
        animation: messenger-pentagram-draw 6s infinite cubic-bezier(0.77, 0, 0.175, 1);
        fill: none;
        stroke: var(--accent);
        stroke-width: 4;
        stroke-linejoin: round;
        stroke-linecap: round;
      }

      @keyframes messenger-pentagram-draw {
        0% { stroke-dashoffset: 1200; stroke-width: 4; }
        15% { stroke-dashoffset: 600; stroke-width: 5; }
        20% { stroke-dashoffset: 700; stroke-width: 4; }
        30% { stroke-dashoffset: 600; }
        75% { stroke-dashoffset: 0; stroke-width: 5; }
        100% { stroke-dashoffset: -1200; stroke-width: 4; }
      }

      @keyframes messenger-pentagram-pulse {
        0%, 100% {
          filter: brightness(1) drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 72%, transparent));
          transform: scale(1) rotate(0deg);
        }
        50% {
          filter: brightness(1.55) drop-shadow(0 0 22px color-mix(in srgb, var(--accent) 90%, transparent));
          transform: scale(1.08) rotate(-4deg);
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <div className={`messenger-pentagram ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="loader-svg">
        <path
          className="messenger-pentagram-path"
          d="M50,95 
            L5,10 
            L95,63 
            L5,63 
            L95,10 
            Z"
        />
      </svg>
    </div>
  );
};
