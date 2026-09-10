import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.TIMESTORY_DIST_DIR ?? ".next",
  serverExternalPackages: ["playwright"],
};
export default config;
