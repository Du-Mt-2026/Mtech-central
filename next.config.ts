import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {},
  webpack: (config, { isServer }) => {
    // @ffmpeg/ffmpeg uses Web Workers and WASM — need special handling (fallback for webpack builds)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      }
    }

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    })

    // Handle .worker.js files from @ffmpeg/ffmpeg
    config.module.rules.push({
      test: /.*\.worker\.js$/,
      type: 'asset/resource',
    })

    return config
  },
};

export default nextConfig;
