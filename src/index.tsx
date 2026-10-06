import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

// Park UI usa la clase .dark: se sigue la preferencia del sistema.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
dark.addEventListener("change", applyTheme);
applyTheme();

render(() => <App />, document.getElementById("root")!);

// Acceso desde la consola del navegador para depurar el protocolo (solo en desarrollo).
if (import.meta.env.DEV) {
  Promise.all([import("./state"), import("./protocol")]).then(([state, protocol]) =>
    Object.assign(window, { g87: { ...state, ...protocol } }),
  );
}
