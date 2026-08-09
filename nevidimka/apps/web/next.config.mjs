/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@nevidimka/db", "@nevidimka/ai", "@nevidimka/shared-types", "@nevidimka/telegram"],
};

export default nextConfig;
