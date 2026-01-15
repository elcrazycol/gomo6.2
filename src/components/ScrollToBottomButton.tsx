import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScrollToBottomButtonProps {
  targetElement?: HTMLElement | null;
  threshold?: number; // Distance from bottom to show button (in pixels)
  className?: string;
}

export const ScrollToBottomButton = ({
  targetElement,
  threshold = 200,
  className = ""
}: ScrollToBottomButtonProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkScrollPosition = () => {
      const element = targetElement || document.documentElement;
      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;

      // Show button if we're more than threshold pixels from the bottom
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setIsVisible(distanceFromBottom > threshold);
    };

    const element = targetElement || window;
    element.addEventListener('scroll', checkScrollPosition, { passive: true });

    // Initial check
    checkScrollPosition();

    return () => {
      element.removeEventListener('scroll', checkScrollPosition);
    };
  }, [targetElement, threshold]);

  const scrollToBottom = () => {
    const element = targetElement || document.documentElement;

    if (targetElement) {
      targetElement.scrollTo({
        top: targetElement.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  if (!isVisible) return null;

  return (
    <Button
      onClick={scrollToBottom}
      className={`fixed bottom-20 right-6 z-[60] h-12 w-12 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 shadow-lg hover:bg-background/90 transition-all duration-200 ${className}`}
      size="icon"
      title="Перейти к последним сообщениям"
    >
      <ChevronDown className="h-5 w-5" />
    </Button>
  );
};