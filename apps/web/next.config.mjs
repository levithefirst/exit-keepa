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
  },
};

export default nextConfig;
