import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the floating dev-tools badge covers the transport's bottom-left buttons
  devIndicators: false,
  // self-contained server bundle for the Docker image
  output: "standalone",
};

export default nextConfig;
