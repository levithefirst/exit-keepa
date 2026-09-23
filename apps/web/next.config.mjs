/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@exit-keepa/shared"],
  env: {
    // Falls back to the live Railway API so a Vercel deploy never fails
    // build just because the dashboard env var hasn't been set yet.
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ??
      "https://api-production-2e11.up.railway.app",
    // Optional in-app Safe creation on the Connect your Safe screen. Off
    // unless the web build sets it to exactly "true".
    SAFE_CREATION_ENABLED: process.env.SAFE_CREATION_ENABLED ?? "false",
  },
};

export default nextConfig;
