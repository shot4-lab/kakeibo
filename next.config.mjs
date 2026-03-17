import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import("next").NextConfig | ((phase: string) => import("next").NextConfig)} */
const nextConfig = (phase) => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    ...(isDev
      ? {
          distDir: ".next-dev",
          webpack: (config) => {
            config.cache = false;
            return config;
          },
        }
      : {}),
  };
};

export default nextConfig;
