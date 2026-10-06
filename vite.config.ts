import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages sirve el repo en /mchose-g87/ (también en `vite preview`); BASE_PATH permite otra ruta.
  base: command === "build" || isPreview ? (process.env.BASE_PATH ?? "/mchose-g87/") : "/",
  plugins: [
    solid(),
    VitePWA({
      // El service worker se actualiza solo al publicar una versión nueva.
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "icon.svg"],
      manifest: {
        name: "MCHOSE G87 Configurator",
        short_name: "G87",
        description: "Configurador del teclado MCHOSE G87: iluminación, teclas, macros y más, por WebHID.",
        lang: "es",
        theme_color: "#111111",
        background_color: "#111111",
        display: "standalone",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,ico}"] },
    }),
  ],
  build: {
    // El código generado por Panda (styled-system/) ubica /* @__PURE__ */ donde rolldown lo ignora: es inofensivo.
    rolldownOptions: { checks: { invalidAnnotation: false, pluginTimings: false } },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      "styled-system": fileURLToPath(new URL("./styled-system", import.meta.url)),
    },
  },
}));
