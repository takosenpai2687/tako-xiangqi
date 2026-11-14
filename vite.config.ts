import { defineConfig } from "vite";
import { compression } from "vite-plugin-compression2";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  base: "./",
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  plugins: [
    // Emit .gz siblings for hosts that serve precompressed files. Assets gzip
    // cannot shrink (WebP is already entropy-coded) are skipped automatically.
    compression({
      algorithms: ["gzip"],
      include: /\.(html|css|js|mjs|json|svg|webp)$/,
      skipIfLargerOrEqual: true,
    }),
  ],
});
