import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

export default nextConfig;
