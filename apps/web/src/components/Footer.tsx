export const Footer = () => {
  return (
    <footer className="bg-card border-t border-border">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground">
            © 2026 gomo6
          </p>
          <a href="/dev" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Dev
          </a>
          <a href="/docs" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Docs
          </a>
        </div>
      </div>
    </footer>
  );
};
