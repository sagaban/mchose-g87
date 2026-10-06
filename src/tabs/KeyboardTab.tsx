import { RotateCcw, X } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { HStack, Stack } from "styled-system/jsx";
import Board from "~/components/Board";
import { DataList, mono, muted, Panel } from "~/components/common";
import KeyPicker from "~/components/KeyPicker";
import OsModeSwitch from "~/components/OsModeSwitch";
import { factoryAssignment, sameAssignment } from "~/components/keymap";
import { Button } from "~/components/ui/button";
import * as Dialog from "~/components/ui/dialog";
import { IconButton } from "~/components/ui/icon-button";
import * as SegmentGroup from "~/components/ui/segment-group";
import {
  ConfigOffset,
  describeAssignment,
  hexBytes,
  keyAssignment,
  LAYERS,
  withAssignment,
  type Assignment,
  type Key,
} from "~/protocol";
import { config, device, layers, macros, readLayer, run, sameBytes, setConfig, waking } from "~/state";

/** Descripción de una asignación con el nombre de la macro, si ya se leyeron. */
const withMacroName = (a: Assignment) => {
  const name = a[0] === 3 && a[2] === 1 ? macros()?.[a[3]]?.name : undefined;
  return name ? `${describeAssignment(a)} ("${name}")` : describeAssignment(a);
};

export default function KeyboardTab() {
  const [layerId, setLayerId] = createSignal(0);
  const [reading, setReading] = createSignal(false);
  const [selected, setSelected] = createSignal<Key | null>(null);
  const [chosen, setChosen] = createSignal<Assignment | null>(null);
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const layer = () => layers[layerId()];
  const layerName = () => LAYERS[layerId()].name;

  const read = async () => {
    setReading(true);
    await run(async () => {
      await readLayer(layerId());
      // El modo Windows/Mac está en la configuración: se lee también si todavía no se tiene.
      if (!config()) setConfig(await device.readConfig(waking));
    });
    setReading(false);
  };

  const select = (k: Key | null) => {
    setSelected(k);
    setChosen(null);
    setStatus("");
  };


  /** Lee la capa, cambia los 4 bytes de la tecla, escribe la capa entera y verifica releyendo. */
  const apply = async (key: Key, value: Assignment) => {
    const id = layerId();
    setBusy(true);
    setStatus("Leyendo capa…");
    const result = await run(async () => {
      const fresh = await readLayer(id);
      const next = withAssignment(fresh, key, value);
      if (sameBytes(next, fresh)) return "Ya tenía esa asignación.";
      setStatus("Escribiendo…");
      await device.writeLayer(id, next);
      setStatus("Verificando…");
      const after = await readLayer(id);
      return sameBytes(after, next) ? "Aplicado ✓" : "El teclado guardó otros valores: revisá la consola.";
    });
    setBusy(false);
    setStatus(result ?? "Error: ver la consola HID.");
    if (result === "Aplicado ✓") setChosen(null);
  };

  return (
    <Stack gap="4">
      <HStack gap="3" flexWrap="wrap">
        <SegmentGroup.Root
          size="sm"
          value={String(layerId())}
          onValueChange={(d) => {
            if (!d.value) return;
            setLayerId(Number(d.value));
            setChosen(null);
            setStatus("");
          }}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items items={LAYERS.map((l) => ({ value: String(l.id), label: l.name }))} />
        </SegmentGroup.Root>
        <Button size="sm" colorPalette="blue" loading={reading()} loadingText="Leyendo…" onClick={read}>
          Leer capa
        </Button>
        <span class={muted}>
          {layer()
            ? layerId() === 0
              ? "Resaltadas: distintas de fábrica."
              : "Resaltadas: distintas de fábrica. Punteadas: sin asignar en esta capa."
            : `Capa ${layerName()} sin leer.`}
        </span>
        <Show when={config()}>
          <HStack gap="2" ms="auto">
            <span class={muted}>Modo</span>
            <OsModeSwitch hint={false} />
          </HStack>
        </Show>
      </HStack>

      <Show when={config()?.[ConfigOffset.osMode] === 2}>
        <p class={muted}>
          El teclado está en modo Mac: al usarlo, el firmware intercambia Win y Alt izquierdo y las F1–F12 pasan a ser
          multimedia (con Fn, F1–F12). Acá se ve lo que está guardado en las capas, que no cambia con el modo.
        </p>
      </Show>

      <Board layerId={layerId()} layer={layer()} selected={selected()} onSelect={select} />

      <p class={muted}>Leé una capa y tocá una tecla para cambiar lo que hace.</p>

      {/* Panel de la tecla como diálogo: el selector entero queda a la vista sin scrollear. */}
      <Dialog.Root
        open={!!selected()}
        onOpenChange={(d) => !d.open && !busy() && select(null)}
        closeOnInteractOutside={!busy()}
        lazyMount
        unmountOnExit
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content maxW="5xl" w="92vw">
              <Show when={selected()}>
                {(key) => (
                  <>
                    <Dialog.Header>
                      <Dialog.Title>
                        {key().label} <span class={muted}>· capa {layerName()}</span>
                      </Dialog.Title>
                    </Dialog.Header>
                    <Dialog.CloseTrigger
                      asChild={(p) => (
                        <IconButton {...p()} size="sm" variant="plain" aria-label="Cerrar" title="Cerrar (Esc)" position="absolute" top="3" right="3">
                          <X />
                        </IconButton>
                      )}
                    />
                    <Show
                      when={layer()}
                      fallback={
                        <Dialog.Body>
                          <p class={muted}>Leé la capa {layerName()} para ver y cambiar esta tecla.</p>
                        </Dialog.Body>
                      }
                    >
                      {(data) => {
                        const current = () => keyAssignment(data(), key());
                        const factory = () => factoryAssignment(key(), layerId());
                        return (
                          <>
                            <Dialog.Body>
                              <Stack gap="4" w="full">
                                <DataList
                                  items={[
                                    ["Ahora", <>{withMacroName(current())} <span class={mono}>{hexBytes(current())}</span></>],
                                    ["De fábrica", <>{describeAssignment(factory())} <span class={mono}>{hexBytes(factory())}</span></>],
                                  ]}
                                />
                                <KeyPicker current={current()} chosen={chosen()} onChoose={setChosen} />
                              </Stack>
                            </Dialog.Body>
                            <Dialog.Footer justifyContent="space-between" flexWrap="wrap" gap="3">
                              <span>
                                Nueva: <b>{chosen() ? withMacroName(chosen()!) : "—"}</b> <span class={muted}>{status()}</span>
                              </span>
                              <HStack gap="2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy() || sameAssignment(current(), factory())}
                                  onClick={() => apply(key(), factory())}
                                >
                                  <RotateCcw /> Volver a fábrica
                                </Button>
                                <Button
                                  size="sm"
                                  colorPalette="blue"
                                  loading={busy()}
                                  disabled={!chosen() || sameAssignment(chosen()!, current())}
                                  onClick={() => apply(key(), chosen()!)}
                                >
                                  Aplicar
                                </Button>
                              </HStack>
                            </Dialog.Footer>
                          </>
                        );
                      }}
                    </Show>
                  </>
                )}
              </Show>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Stack>
  );
}
