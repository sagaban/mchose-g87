import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// Genera los íconos de la PWA (favicon, apple-touch, 192, 512 y maskable) a partir de public/icon.svg.
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/icon.svg"],
});
