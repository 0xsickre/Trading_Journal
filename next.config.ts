import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `lzma` decodes Dukascopy's `.bi5` candle files (MAE/MFE for backtest
   * accounts). Its entry point loads its own code through a runtime
   * `path.join(__dirname, …)`, which a bundler cannot follow — the production
   * build failed on it, and importing the decoder file by path fails too, since
   * it exports through `this` rather than `module.exports`. Left out of the
   * bundle, it is required by Node at run time exactly as its authors intended.
   */
  serverExternalPackages: ["lzma"],
};

export default nextConfig;
