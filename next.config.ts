import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No permissive CORS or external-provider restrictions are introduced.
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=()' },
      ],
    }];
  },
  cacheComponents: true,
};

export default nextConfig;
