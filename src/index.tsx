import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

// Park UI usa la clase .dark: se sigue la preferencia del sistema.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
dark.addEventListener("change", applyTheme);
applyTheme();

render(() => <App />, document.getElementById("root")!);
