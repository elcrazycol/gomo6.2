import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.gomo6.app',
  appName: 'gomo6',
  webDir: 'dist',
  server: {
    // https scheme so the Android WebView never blocks mixed content
    // (the API and storage are served over https in production).
    androidScheme: 'https',
    // For device live-reload during development point the app at the local
    // Vite dev server instead of the bundled dist:
    // url: 'http://<LAN-IP>:8081',
  },
  plugins: {
    Keyboard: {
      // iOS: the layout viewport stays put and the body is resized around the
      // keyboard, so the web app keeps full control via --kb-inset/--app-vh
      // (set by lib/capacitor.ts on native). Try 'native' if anything shifts.
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
