import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // For GitHub Pages: repo is at https://zkyko.github.io/EDI/
  // Vite needs to know assets live under /EDI/
  base: "/EDI/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
