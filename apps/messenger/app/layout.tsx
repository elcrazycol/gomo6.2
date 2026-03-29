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
                  html.classList.add(savedMode ? ('theme-' + savedColor + '-dark') : ('theme-' + savedColor));
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
