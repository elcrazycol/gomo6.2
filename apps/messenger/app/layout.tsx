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
                  var savedColor = localStorage.getItem('color-theme') || 'cannabis';
                  var savedMode = localStorage.getItem('dark-mode') === 'true';
                  var html = document.documentElement;
                  html.classList.remove(
                    'theme-cannabis', 'theme-cannabis-dark',
                    'theme-pink', 'theme-pink-dark',
                    'theme-blue', 'theme-blue-dark',
                    'theme-blood', 'theme-blood-dark',
                    'theme-pumpkin', 'theme-pumpkin-dark'
                  );
                  html.classList.add(savedMode ? ('theme-' + savedColor + '-dark') : ('theme-' + savedColor));

                  var savedFont = localStorage.getItem('custom_font');
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
