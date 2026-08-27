export const Footer = () => {
  // Use window.location.hostname so subdomain links work both locally
  // (dev.localhost, docs.localhost) and in production (dev.example.com, docs.example.com)
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  // Strip known subdomain prefixes to get the root domain
  // docs.localhost → localhost | docs.example.com → example.com
  const rootDomain = hostname.replace(/^(docs|dev|www)\./, '');

  // Git commit hash injected at build time via VITE_GIT_COMMIT
  const commitHash = import.meta.env.VITE_GIT_COMMIT;
  const shortHash = commitHash && commitHash !== 'unknown' ? commitHash.slice(0, 7) : null;

  // Product version injected at build time via VITE_APP_VERSION (root VERSION file)
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const versionLabel = appVersion && appVersion !== 'unknown' ? `v${appVersion}` : null;

  return (
    <footer className="bg-card border-t border-border">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground">
            © 2026 gomo6
          </p>
          {versionLabel && <span className="text-xs text-muted-foreground/70 font-medium">{versionLabel}</span>}
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
          {shortHash && (
            <span className="text-xs text-muted-foreground/50 font-mono" title={`Deployed commit: ${commitHash}`}>
              {shortHash}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
};
