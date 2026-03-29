import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gomo6 messenger",
  description: "Secure end-to-end encrypted messenger for gomo6",
  icons: {
    icon: `${process.env.APP_BASE_URL || "https://gomo6.wtf"}/photoes/gomo6.png`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var cookieMap = document.cookie.split(';').reduce(function(acc, part) {
                    var section = part.trim();
                    if (!section) return acc;
                    var eqIndex = section.indexOf('=');
                    var key = eqIndex === -1 ? section : section.slice(0, eqIndex);
                    var value = eqIndex === -1 ? '' : section.slice(eqIndex + 1);
                    acc[key] = decodeURIComponent(value);
                    return acc;
                  }, {});
                  var savedColor = cookieMap.gomo6_color_theme || localStorage.getItem('color-theme') || 'cannabis';
                  var savedModeValue = cookieMap.gomo6_dark_mode || localStorage.getItem('dark-mode');
                  var savedMode = savedModeValue === 'true';
                  var html = document.documentElement;
                  html.classList.remove(
                    'theme-cannabis', 'theme-cannabis-dark',
                    'theme-pink', 'theme-pink-dark',
                    'theme-blue', 'theme-blue-dark',
                    'theme-blood', 'theme-blood-dark',
                    'theme-pumpkin', 'theme-pumpkin-dark'
                  );
                  html.classList.add(savedMode ? ('theme-' + savedColor + '-dark') : ('theme-' + savedColor));

                  var savedFont = cookieMap.gomo6_custom_font || localStorage.getItem('custom_font');
                  if (savedFont) {
                    var link = document.createElement('link');
                    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(savedFont) + ':wght@400;500;600;700&display=swap';
                    link.rel = 'stylesheet';
                    link.setAttribute('data-google-font', 'true');
                    document.head.appendChild(link);

                    var fontFamily = '"' + savedFont + '", system-ui, -apple-system, sans-serif';
                    document.documentElement.style.setProperty('--font-family', fontFamily);
                    document.body.style.fontFamily = fontFamily;
                  }
                } catch (error) {}
              })();
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
