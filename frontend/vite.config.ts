import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // For GitHub Pages: repo is at https://zkyko.github.io/EDI/
  base: "/EDI/",
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
