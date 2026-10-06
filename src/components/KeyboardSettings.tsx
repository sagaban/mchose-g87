import { createSignal, Show } from "solid-js";
import { css } from "styled-system/css";
import { HStack, Stack } from "styled-system/jsx";
import { DataList, muted, Panel } from "~/components/common";
import * as Checkbox from "~/components/ui/checkbox";
import * as SegmentGroup from "~/components/ui/segment-group";
import * as Slider from "~/components/ui/slider";
import * as Switch from "~/components/ui/switch";
import { ConfigOffset, LATENCY, POLLING_RATES, sleepMinutes, sleepValue } from "~/protocol";
import { config, run, updateConfig } from "~/state";
import OsModeSwitch from "./OsModeSwitch";

/**
 * Ajustes generales guardados en la configuración. Nombres y valores según el driver web oficial para el G87;
 * cada cambio relee, cambia solo su byte, escribe y verifica.
 */
export default function KeyboardSettings() {
  const [status, setStatus] = createSignal("");
  const cfg = () => config()!;

  const set = async (label: string, edit: (c: Uint8Array) => void) => {
    setStatus(`Guardando ${label}…`);
    const ok = await run(() => updateConfig(edit));
    setStatus(ok === undefined ? "Error: ver la consola HID." : ok ? `${label[0].toUpperCase()}${label.slice(1)} guardado ✓` : "El teclado guardó otro valor.");
  };

  const sleep = () => cfg()[ConfigOffset.sleep];
  const isMac = () => cfg()[ConfigOffset.osMode] === 2;
  // Mientras se arrastra el slider se muestra el valor; se guarda al soltar.
  const [sleepDraft, setSleepDraft] = createSignal<number | null>(null);

  return (
    <Show when={config()}>
      <Panel title="Ajustes" description={status() || "Se guardan en el teclado al cambiarlos."}>
        <DataList
          spacious
          items={[
            ["Modo", <OsModeSwitch />],
            [
              "Tasa de sondeo",
              <SegmentGroup.Root
                size="xs"
                value={String(cfg()[ConfigOffset.pollingRate])}
                onValueChange={(d) => d.value && set("la tasa de sondeo", (c) => (c[ConfigOffset.pollingRate] = Number(d.value)))}
              >
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={POLLING_RATES.map((r) => ({ value: String(r.value), label: r.label }))} />
              </SegmentGroup.Root>,
            ],
            [
              "Top Speed",
              <Stack gap="1">
                <Switch.Root
                  colorPalette="blue"
                  checked={cfg()[ConfigOffset.latency] === LATENCY.on}
                  onCheckedChange={(d) =>
                    set("el modo Top Speed", (c) => (c[ConfigOffset.latency] = d.checked ? LATENCY.on : LATENCY.off))
                  }
                >
                  <Switch.Control />
                  <Switch.Label>Modo de baja latencia</Switch.Label>
                  <Switch.HiddenInput />
                </Switch.Root>
                <span class={muted}>Si alguna tecla empieza a registrar dobles pulsaciones, conviene desactivarlo.</span>
              </Stack>,
            ],
            [
              "Tecla Win",
              <Stack gap="1">
                <Switch.Root
                  colorPalette="blue"
                  disabled={isMac()}
                  checked={cfg()[ConfigOffset.winLock] === 1}
                  onCheckedChange={(d) => set("el bloqueo de Win", (c) => (c[ConfigOffset.winLock] = d.checked ? 1 : 0))}
                >
                  <Switch.Control />
                  <Switch.Label>Bloquear (como Fn + Win)</Switch.Label>
                  <Switch.HiddenInput />
                </Switch.Root>
                <Show when={isMac()}>
                  <span class={muted}>En modo Mac no se puede bloquear.</span>
                </Show>
              </Stack>,
            ],
            [
              "Suspensión",
              <Stack gap="2" w="full" maxW="md">
                <Show when={sleep() !== 0}>
                  <Slider.Root
                    min={0.5}
                    max={20}
                    step={0.5}
                    value={[sleepDraft() ?? sleepMinutes(sleep())]}
                    onValueChange={(d) => setSleepDraft(d.value[0])}
                    onValueChangeEnd={(d) => {
                      setSleepDraft(null);
                      set("la suspensión", (c) => (c[ConfigOffset.sleep] = sleepValue(d.value[0])));
                    }}
                    colorPalette="blue"
                  >
                    <HStack justify="space-between">
                      <Slider.Label>Se duerme sin uso a los</Slider.Label>
                      <span class={css({ textStyle: "sm" })}>{(sleepDraft() ?? sleepMinutes(sleep())).toLocaleString("es")} min</span>
                    </HStack>
                    <Slider.Control>
                      <Slider.Track>
                        <Slider.Range />
                      </Slider.Track>
                      <Slider.Thumbs />
                    </Slider.Control>
                  </Slider.Root>
                </Show>
                <Checkbox.Root
                  colorPalette="blue"
                  checked={sleep() === 0}
                  onCheckedChange={(d) => set("la suspensión", (c) => (c[ConfigOffset.sleep] = d.checked ? 0 : sleepValue(1)))}
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Checkbox.Label>Nunca (gasta más batería)</Checkbox.Label>
                  <Checkbox.HiddenInput />
                </Checkbox.Root>
              </Stack>,
            ],
          ]}
        />
      </Panel>
    </Show>
  );
}
