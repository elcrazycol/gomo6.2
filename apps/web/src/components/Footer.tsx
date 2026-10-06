import { NavigationLink } from "@/components/NavigationLink";

import { openCookieSettings } from "@/lib/cookieConsent";
import { BRAND } from "@/lib/legal/config";

const linkClass =
  "text-xs text-muted-foreground hover:text-foreground transition-colors";

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
      <div className="max-w-6xl mx-auto px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <p className="text-xs sm:text-sm text-muted-foreground">
            © {new Date().getFullYear()} {BRAND.name}
          </p>
          {versionLabel && <span className="text-xs text-muted-foreground/70 font-medium">{versionLabel}</span>}
          <NavigationLink to="/legal/terms" className={linkClass}>
            Соглашение
          </NavigationLink>
          <NavigationLink to="/legal/privacy" className={linkClass}>
            Конфиденциальность
          </NavigationLink>
          <NavigationLink to="/legal/rules" className={linkClass}>
            Правила
          </NavigationLink>
          <button
            type="button"
            onClick={openCookieSettings}
            className={linkClass}
          >
            Куки
          </button>
          <a
            href={devHref}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Dev
          </a>
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
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
