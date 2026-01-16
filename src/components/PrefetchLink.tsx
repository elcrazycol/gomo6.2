import { Link, LinkProps } from "react-router-dom";
import { useEffect, useState } from "react";

interface PrefetchLinkProps extends LinkProps {
  prefetch?: boolean;
  children: React.ReactNode;
}

export const PrefetchLink = ({ prefetch = true, to, children, ...props }: PrefetchLinkProps) => {
  const [isPrefetched, setIsPrefetched] = useState(false);

  const handleMouseEnter = () => {
    if (prefetch && !isPrefetched && typeof to === 'string') {
      // Prefetch the route
      const route = to.split('/')[1]; // Get first part of path
      switch (route) {
        case 'auth':
          import("../pages/Auth");
          break;
        case 'settings':
          import("../pages/Settings");
          break;
        case 'profile':
          import("../pages/Profile");
          break;
        case 'messages':
          import("../pages/Messages");
          break;
        case 'moderation':
          import("../pages/Moderation");
          break;
        default:
          // For boards and threads, prefetch the components
          if (to.includes('/thread/')) {
            import("../pages/Thread");
          } else if (!to.includes('.')) { // Not a file extension
            import("../pages/Board");
          }
      }
      setIsPrefetched(true);
    }
  };

  return (
    <Link to={to} onMouseEnter={handleMouseEnter} {...props}>
      {children}
    </Link>
  );
};