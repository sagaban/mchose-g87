import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    // El código generado por Panda (styled-system/) ubica /* @__PURE__ */ donde rolldown lo ignora: es inofensivo.
    rolldownOptions: { checks: { invalidAnnotation: false } },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      "styled-system": fileURLToPath(new URL("./styled-system", import.meta.url)),
    },
  },
});
