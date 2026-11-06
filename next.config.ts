import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/^\/auth\/verify/] } },
  // Keep AGENTS.md exactly as required by SPEC section 1.
  agentRules: false,
  experimental: { authInterrupts: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV !== "production" ? "'unsafe-eval'" : ""} https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://oauth.telegram.org https://telegram.org`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
