import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";


export const CookieBanner = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('cookies-accepted');
    if (!accepted) {
      // Show banner after a short delay
      const timer = setTimeout(() => setShow(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem('cookies-accepted', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-4 shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Мы используем куки для улучшения вашего опыта. Продолжая использовать сайт, вы соглашаетесь с нашей{" "}
            <a href="/rules" className="text-primary hover:underline">
              политикой конфиденциальности
            </a>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={acceptCookies}>
            Принять
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShow(false)}
            className="p-1"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};