import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works from any sub-path
  // (GitHub Pages serves it at /<repo>/).
  base: "./",
  server: {
    port: 8080,
    open: true,
  },
});
