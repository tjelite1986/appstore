// Everything is self-hosted: no external scripts, styles, fonts or images.
// 'unsafe-inline' script/style is required by Next's hydration payload and by
// Tailwind. Tighten nothing else until a feature actually needs it.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Built on the host and bind-mounted into a bare node:20-slim container —
  // see compose/appstore. Deploy is `npm run build` + `docker restart`.
  output: "standalone",
  reactStrictMode: true,
  // teleproto is a large MTProto stack full of dynamic requires; bundling it
  // breaks it. Left external, the standalone tracer copies it into the output
  // instead — see lib/telegram.ts.
  serverExternalPackages: ["teleproto"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
