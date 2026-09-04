import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "index.html",
        content: "src/content.ts",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
