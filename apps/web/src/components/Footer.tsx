export const Footer = () => {
  // Use window.location.hostname so subdomain links work both locally
  // (dev.localhost, docs.localhost) and in production (dev.example.com, docs.example.com)
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  // Strip known subdomain prefixes to get the root domain
  // docs.localhost → localhost | docs.example.com → example.com
  const rootDomain = hostname.replace(/^(docs|dev|www)\./, '');

  return (
    <footer className="bg-card border-t border-border">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground">
            © 2026 gomo6
          </p>
          <a
            href={`//dev.${rootDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dev
          </a>
          <a
            href={`//docs.${rootDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </a>
        </div>
      </div>
    </footer>
  );
};
