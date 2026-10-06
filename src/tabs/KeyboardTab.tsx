import { RotateCcw } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { HStack, Stack } from "styled-system/jsx";
import Board from "~/components/Board";
import { DataList, mono, muted, Panel } from "~/components/common";
import KeyPicker from "~/components/KeyPicker";
import { factoryAssignment, sameAssignment } from "~/components/keymap";
import { Button } from "~/components/ui/button";
import * as SegmentGroup from "~/components/ui/segment-group";
import {
  describeAssignment,
  hexBytes,
  keyAssignment,
  LAYERS,
  withAssignment,
  type Assignment,
  type Key,
} from "~/protocol";
import { device, layers, readLayer, run, sameBytes } from "~/state";

export default function KeyboardTab() {
  const [layerId, setLayerId] = createSignal(0);
  const [reading, setReading] = createSignal(false);
  const [selected, setSelected] = createSignal<Key | null>(null);
  const [chosen, setChosen] = createSignal<Assignment | null>(null);
  const [status, setStatus] = createSignal("");

  const layer = () => layers[layerId()];
  const layerName = () => LAYERS[layerId()].name;

  const read = async () => {
    setReading(true);
    await run(() => readLayer(layerId()));
    setReading(false);
  };

  const select = (k: Key) => {
    setSelected(k);
    setChosen(null);
    setStatus("");
  };

  /** Lee la capa, cambia los 4 bytes de la tecla, escribe la capa entera y verifica releyendo. */
  const apply = async (key: Key, value: Assignment) => {
    const id = layerId();
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
      </HStack>

      <Board layerId={layerId()} layer={layer()} selected={selected()} onSelect={select} />

      <Show when={selected()} fallback={<p class={muted}>Leé una capa y tocá una tecla para cambiar lo que hace.</p>}>
        {(key) => (
          <Panel title={<>{key().label} <span class={muted}>· capa {layerName()}</span></>}>
            <Show when={layer()} fallback={<p class={muted}>Leé la capa {layerName()} para ver y cambiar esta tecla.</p>}>
              {(data) => {
                const current = () => keyAssignment(data(), key());
                const factory = () => factoryAssignment(key(), layerId());
                return (
                  <Stack gap="4">
                    <DataList
                      items={[
                        ["Ahora", <>{describeAssignment(current())} <span class={mono}>{hexBytes(current())}</span></>],
                        ["De fábrica", <>{describeAssignment(factory())} <span class={mono}>{hexBytes(factory())}</span></>],
                      ]}
                    />
                    <KeyPicker current={current()} chosen={chosen()} onChoose={setChosen} />
                    <HStack gap="3" flexWrap="wrap">
                      <span>
                        Nueva: <b>{chosen() ? describeAssignment(chosen()!) : "—"}</b>
                      </span>
                      <Button size="sm" variant="outline" disabled={sameAssignment(current(), factory())} onClick={() => apply(key(), factory())}>
                        <RotateCcw /> Volver a fábrica
                      </Button>
                      <Button
                        size="sm"
                        colorPalette="blue"
                        disabled={!chosen() || sameAssignment(chosen()!, current())}
                        onClick={() => apply(key(), chosen()!)}
                      >
                        Aplicar
                      </Button>
                      <span class={muted}>{status()}</span>
                    </HStack>
                  </Stack>
                );
              }}
            </Show>
          </Panel>
        )}
      </Show>
    </Stack>
  );
}
