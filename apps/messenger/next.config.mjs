/** @type {import('next').NextConfig} */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).origin : null;
const realtimeHost = supabaseHost ? supabaseHost.replace("https://", "wss://") : null;

const csp = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: https:",
  `connect-src 'self' https://gomo6.wtf https://www.gomo6.wtf https://m.gomo6.wtf https://gomo6.ru https://www.gomo6.ru https://m.gomo6.ru${supabaseHost ? ` ${supabaseHost}` : ""}${realtimeHost ? ` ${realtimeHost}` : ""}`,
  // Next.js injects a small amount of inline bootstrap/runtime code in production.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests"
].join("; ");

const nextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_BASE_URL: process.env.NEXT_PUBLIC_APP_BASE_URL || process.env.APP_BASE_URL || "https://gomo6.wtf",
    NEXT_PUBLIC_MESSENGER_BASE_URL:
      process.env.NEXT_PUBLIC_MESSENGER_BASE_URL || process.env.MESSENGER_BASE_URL || "https://m.gomo6.wtf",
  },
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
