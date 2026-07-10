import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  transpilePackages: [
    "@deck.gl/core",
    "@deck.gl/geo-layers",
    "@deck.gl/layers",
    "@deck.gl/mapbox",
    "@deck.gl/mesh-layers",
    "@deck.gl/react",
    "@loaders.gl/core",
    "@loaders.gl/gltf",
    "@luma.gl/core",
    "@luma.gl/webgl",
  ],
};

export default nextConfig;
