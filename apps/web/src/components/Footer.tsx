export const Footer = () => {
  // Use window.location.hostname so subdomain links work both locally
  // (localhost ports) and in production (dev.example.com, docs.example.com)
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  // Strip known subdomain prefixes to get the root domain
  // docs.example.com → example.com | localhost → localhost
  const rootDomain = hostname.replace(/^(docs|dev|www)\./, '');
  const isLocal = rootDomain === 'localhost' || rootDomain === '127.0.0.1' || hostname.endsWith('.localhost');

  // Locally the dev tools run on their own Vite ports; in production they are
  // subdomains behind the reverse proxy.
  const devHref = isLocal ? 'http://localhost:3002' : `//dev.${rootDomain}`;
  const docsHref = isLocal ? 'http://localhost:3001' : `//docs.${rootDomain}`;

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
            href={devHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dev
          </a>
          <a
            href={docsHref}
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
