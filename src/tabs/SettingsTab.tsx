import { Show } from "solid-js";
import { muted } from "~/components/common";
import KeyboardSettings from "~/components/KeyboardSettings";
import { config, hasVendorChannel } from "~/state";

/** Ajustes generales del teclado (modo, tasa de sondeo, Top Speed, bloqueo de Win, suspensión). */
export default function SettingsTab() {
  return (
    <Show
      when={hasVendorChannel() && config()}
      fallback={
        <p class={muted}>
          {hasVendorChannel() ? "Leyendo la configuración del teclado… (si duerme, apretá una tecla)" : "Conectá el teclado para ver y cambiar sus ajustes."}
        </p>
      }
    >
      <KeyboardSettings />
    </Show>
  );
}
