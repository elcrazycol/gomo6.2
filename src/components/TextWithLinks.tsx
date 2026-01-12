import React from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface TextWithLinksProps {
  text: string;
  className?: string;
}

// Function to extract domain from URL
const extractDomain = (url: string): string => {
  try {
    // Remove protocol
    let domain = url.replace(/^https?:\/\//, '');

    // Remove www.
    domain = domain.replace(/^www\./, '');

    // Remove path and query parameters
    domain = domain.split('/')[0];

    // Split by dots and take last 2-3 parts (for subdomains)
    const parts = domain.split('.');
    if (parts.length >= 3) {
      // For subdomains like sub.domain.com
      return parts.slice(-3).join('.');
    } else if (parts.length >= 2) {
      // For domains like domain.com
      return parts.slice(-2).join('.');
    }

    return domain;
  } catch (error) {
    return url;
  }
};

// Function to parse text and extract links
const parseTextWithLinks = (text: string) => {
  // URL regex pattern
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }

    // Add the link
    parts.push({
      type: 'link',
      content: match[0],
      domain: extractDomain(match[0])
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return parts;
};

export const TextWithLinks: React.FC<TextWithLinksProps> = ({ text, className = "" }) => {
  const parts = parseTextWithLinks(text);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.type === 'link') {
          return (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className="inline-flex items-center gap-1 h-auto px-2 py-0.5 mx-1 text-xs font-medium bg-primary/10 border-primary/20 hover:bg-primary/20 transition-colors"
              onClick={() => window.open(part.content, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="h-3 w-3" />
              {part.domain}
            </Button>
          );
        }

        // Handle line breaks in text
        return part.content.split('\n').map((line, lineIndex, lineArray) => (
          <React.Fragment key={`${index}-${lineIndex}`}>
            {line}
            {lineIndex < lineArray.length - 1 && <br />}
          </React.Fragment>
        ));
      })}
    </span>
  );
};