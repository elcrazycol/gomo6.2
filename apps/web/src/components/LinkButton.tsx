import React from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface LinkButtonProps {
  url: string;
  className?: string;
}

const shortenUrl = (url: string): string => {
  try {
    // Remove protocol (http://, https://, etc.)
    let cleanUrl = url.replace(/^https?:\/\//, '');

    // Remove www. prefix if present
    cleanUrl = cleanUrl.replace(/^www\./, '');

    // Split by dots and take relevant parts
    const parts = cleanUrl.split('.');

    if (parts.length >= 2) {
      // For subdomains like sub.domain.com, take last two parts
      if (parts.length > 2) {
        const lastTwo = parts.slice(-2);
        return `${lastTwo[0]}.${lastTwo[1]}`;
      } else {
        // For simple domains like domain.com
        return `${parts[0]}.${parts[1]}`;
      }
    }

    // Fallback: return original if parsing fails
    return cleanUrl.length > 20 ? cleanUrl.substring(0, 20) + '...' : cleanUrl;
  } catch {
    return url.length > 20 ? url.substring(0, 20) + '...' : url;
  }
};

export const LinkButton: React.FC<LinkButtonProps> = ({ url, className }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const shortenedUrl = shortenUrl(url);

  return (
    <Button
      variant="outline"
      size="sm"
      className={`inline-flex items-center gap-1 h-6 px-2 py-0 text-xs font-medium bg-background/80 hover:bg-primary/10 hover:text-primary border-border/60 hover:border-primary/50 transition-all duration-200 cursor-pointer rounded-lg ${className || ''}`}
      onClick={handleClick}
      title={url}
    >
      <span className="truncate max-w-24">{shortenedUrl}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
    </Button>
  );
};