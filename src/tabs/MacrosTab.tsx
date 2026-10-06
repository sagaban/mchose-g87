import { Circle, Plus, RefreshCw, Square, Trash2 } from "lucide-solid";
import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { css } from "styled-system/css";
import { HStack, Stack, Wrap } from "styled-system/jsx";
import { muted, Panel } from "~/components/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Switch from "~/components/ui/switch";
import {
  buildMacros,
  Cmd,
  describeMacroEvent,
  HID_BY_CODE,
  keyAssignment,
  keymapPayload,
  keys,
  LAYERS,
  MACRO_MODES,
  MACRO_PAGE,
  macroKeyKind,
  MOD_KEY_BY_CODE,
  parseMacros,
  trimmedLength,
  withMacroRemoved,
  type Macro,
  type MacroEvent,
} from "~/protocol";
import * as Dialog from "~/components/ui/dialog";
import { fetchMacroMemory, hid, layers, macroMem, macros, readLayer, readMacroMemory, run, sameBytes } from "~/state";

/** Teclas (en las capas ya leídas) que llaman a la macro `idx`. */
function macroUsage(idx: number) {
  const uses: string[] = [];
  for (const layer of LAYERS) {
    const data = layers[layer.id];
    if (!data) continue;
    for (const key of keys) {
      const [type, mode, hi, lo] = keyAssignment(data, key);
      if (type === 3 && hi === 1 && lo === idx) {
        const prefix = layer.id === 0 ? "" : `${layer.name} + `;
        uses.push(`${prefix}${key.label} (${MACRO_MODES.find((m) => m.mode === mode)?.short ?? mode})`);
      }
    }
  }
  return uses;
}

const layersRead = () => LAYERS.some((l) => layers[l.id]);

function Events(props: { events: MacroEvent[] }) {
  return (
    <Wrap gap="1" maxH="32" overflowY="auto">
      <For each={props.events} fallback={<span class={muted}>Sin eventos todavía.</span>}>
        {(e) => (
          <Badge size="sm" variant={e.down ? "subtle" : "outline"} colorPalette={e.down ? "blue" : "gray"} title={`${e.delay} ms`}>
            {describeMacroEvent(e)}
          </Badge>
        )}
      </For>
    </Wrap>
  );
}

/** Editor: graba eventos del teclado físico con sus tiempos. `index` null = macro nueva. */
function MacroEditor(props: { index: number | null; onClose: () => void }) {
  const existing = () => (props.index === null ? null : macros()![props.index]);
  const [name, setName] = createSignal(existing()?.name ?? `m${(macros()?.length ?? 0) + 1}`);
  const [events, setEvents] = createSignal<MacroEvent[]>(existing()?.events.map((e) => ({ ...e })) ?? []);
  const [fixed, setFixed] = createSignal(true);
  const [delay, setDelay] = createSignal(10);
  const [recording, setRecording] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  let stop: (() => void) | null = null;
  const record = () => {
    setRecording(true);
    let last = 0;
    const push = (e: KeyboardEvent, down: boolean) => {
      if (e.repeat) return e.preventDefault();
      const code = MOD_KEY_BY_CODE[e.code] ?? HID_BY_CODE[e.code];
      if (!code) return;
      e.preventDefault();
      const now = performance.now();
      setEvents((evs) => {
        const next = [...evs];
        // La demora va en el evento anterior: es el tiempo hasta este.
        if (next.length && last) next[next.length - 1] = { ...next[next.length - 1], delay: Math.max(1, Math.round(now - last)) };
        next.push({ down, kind: macroKeyKind(code), code, delay: 10 });
        return next;
      });
      last = now;
    };
    const onDown = (e: KeyboardEvent) => push(e, true);
    const onUp = (e: KeyboardEvent) => push(e, false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    stop = () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      setRecording(false);
      stop = null;
    };
  };
  onCleanup(() => stop?.());

  /**
   * Relee la memoria (y aborta si cambió desde la última lectura), reemplaza o agrega la macro,
   * reescribe la memoria completa conservando las demás y verifica releyendo.
   */
  const save = async () => {
    stop?.();
    const n = name().trim();
    if (!n) return void setStatus("Poné un nombre.");
    if (!events().length) return void setStatus("La macro no tiene eventos.");
    const evs = fixed() ? events().map((e) => ({ ...e, delay: Math.max(1, Math.min(60000, delay())) })) : events();
    const known = macroMem();
    setSaving(true);
    setStatus("Leyendo memoria…");
    const result = await run(async () => {
      const fresh = await readMacroMemory();
      if (!known || !sameBytes(fresh, known))
        return "Las macros del teclado cambiaron desde que las leíste: revisá la lista y volvé a guardar.";
      const list: Macro[] = parseMacros(fresh);
      if (props.index === null) list.push({ name: n, events: evs });
      else list[props.index] = { name: n, events: evs };
      if (!(await writeMacroMemory(list, setStatus))) return "El teclado guardó otros datos: revisá la consola.";
      return `ok:${props.index === null ? list.length : props.index + 1}`;
    });
    setSaving(false);
    if (result?.startsWith("ok:")) {
      setStatus("");
      props.onClose();
    } else setStatus(result ?? "Error: ver la consola HID.");
  };

  return (
    <Panel title={existing() ? `Regrabar ${props.index! + 1}. ${existing()!.name}` : "Nueva macro"}>
      <Stack gap="4">
        <HStack gap="4" alignItems="end" flexWrap="wrap">
          <Field.Root w="48">
            <Field.Label>Nombre</Field.Label>
            <Input size="sm" maxLength={15} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </Field.Root>
          <Switch.Root checked={fixed()} onCheckedChange={(d) => setFixed(d.checked)} colorPalette="blue">
            <Switch.Control />
            <Switch.Label>Demora fija</Switch.Label>
            <Switch.HiddenInput />
          </Switch.Root>
          <Show when={fixed()}>
            <HStack gap="2">
              <Input size="sm" w="24" type="number" min={1} max={60000} value={delay()} onInput={(e) => setDelay(Number(e.currentTarget.value) || 10)} />
              <span class={muted}>ms entre eventos</span>
            </HStack>
          </Show>
        </HStack>

        <HStack gap="2" flexWrap="wrap">
          <Button size="sm" colorPalette={recording() ? "red" : "blue"} onClick={() => (recording() ? stop?.() : record())}>
            {recording() ? <Square /> : <Circle />} {recording() ? "Detener" : "Grabar"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEvents([])}>
            <Trash2 /> Borrar eventos
          </Button>
          <span class={muted}>Mientras graba, todo lo que tipees queda en la macro (no llega a la página).</span>
        </HStack>

        <Events events={events()} />

        <HStack gap="3">
          <Button size="sm" colorPalette="blue" loading={saving()} onClick={save}>
            Guardar en el teclado
          </Button>
          <Button size="sm" variant="outline" onClick={() => (stop?.(), props.onClose())}>
            Cancelar
          </Button>
          <span class={muted}>{status()}</span>
        </HStack>
      </Stack>
    </Panel>
  );
}

/** Escribe la memoria de macros completa, una tanda por página de 512 bytes, y verifica releyendo. */
async function writeMacroMemory(list: Macro[], onStatus: (s: string) => void) {
  // Sin macros se escribe una tabla vacía (4 ceros): la primera dirección en 0 significa "ninguna".
  const mem = list.length ? buildMacros(list) : new Uint8Array(4);
  if (mem.length > 8 * MACRO_PAGE) throw new Error(`No entra: ${mem.length} bytes de ${8 * MACRO_PAGE}.`);
  // Cada página es una tanda aparte: índice desde 0 y la página en el nibble alto del largo
  // (así lo hace la app de Windows; con índices continuos el teclado descarta la página 1).
  for (let page = 0; page * MACRO_PAGE < mem.length; page++) {
    onStatus(`Escribiendo macros, página ${page + 1}…`);
    await hid.writeBlock(Cmd.setMacros, mem.slice(page * MACRO_PAGE, (page + 1) * MACRO_PAGE), { lenTag: page << 4 });
  }
  onStatus("Verificando macros…");
  const after = await readMacroMemory();
  return list.length ? sameBytes(after, mem) : parseMacros(after).length === 0;
}

/**
 * Borrar una macro: lee las tres capas para mostrar qué teclas la usan, y al confirmar
 * reescribe la memoria sin ella y corrige en las capas los índices de las macros posteriores.
 */
function DeleteMacro(props: { index: number; onClose: () => void }) {
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // Nombre fijado al abrir: la lista cambia al borrar.
  const name = macros()![props.index]?.name ?? "";

  // Plan con datos frescos (memoria y las tres capas), leídos sin tocar el estado de la lista.
  const [plan] = createResource(async () => {
    const mem = await fetchMacroMemory();
    const layerData: Uint8Array[] = [];
    for (const l of LAYERS) layerData.push(await readLayer(l.id));
    const changes = LAYERS.map((l, i) => ({ id: l.id, name: l.name, before: layerData[i], ...withMacroRemoved(layerData[i], props.index) }));
    return { mem, changes };
  });

  const cleared = () =>
    plan()?.changes.flatMap((c) => c.cleared.map((k) => (c.id === 0 ? k.label : `${c.name} + ${k.label}`))) ?? [];
  const shiftedCount = () => plan()?.changes.reduce((n, c) => n + c.shifted.length, 0) ?? 0;

  const confirm = async () => {
    const p = plan()!;
    setBusy(true);
    const result = await run(async () => {
      setStatus("Comprobando que nada cambió…");
      if (!sameBytes(await fetchMacroMemory(), p.mem)) return "Las macros cambiaron desde que se armó el plan: cerrá y volvé a intentar.";
      for (const c of p.changes)
        if (!sameBytes(await readLayer(c.id), c.before)) return `La capa ${c.name} cambió desde que se armó el plan: cerrá y volvé a intentar.`;

      const list = parseMacros(p.mem).filter((_, i) => i !== props.index);
      if (!(await writeMacroMemory(list, setStatus))) return "El teclado guardó otros datos en las macros: revisá la consola.";

      for (const c of p.changes) {
        if (!c.cleared.length && !c.shifted.length) continue;
        setStatus(`Actualizando capa ${c.name}…`);
        await hid.writeBlock(Cmd.setKeymap, keymapPayload(c.layer), { lenTag: c.id << 4, lastLen: trimmedLength });
        if (!sameBytes(await readLayer(c.id), c.layer)) return `El teclado guardó otros valores en la capa ${c.name}: revisá la consola.`;
      }
      return "ok";
    });
    setBusy(false);
    if (result === "ok") props.onClose();
    else setStatus(result ?? "Error: ver la consola HID. Si se cortó a mitad de camino, volvé a leer las macros y las capas.");
  };

  return (
    <Dialog.Root open onOpenChange={(d) => !d.open && !busy() && props.onClose()} closeOnInteractOutside={!busy()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>
                Borrar la macro {props.index + 1}. {name}
              </Dialog.Title>
              <Dialog.Description>Se borra del teclado. No se puede deshacer.</Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <Show
                when={plan()}
                fallback={
                  <span class={muted}>
                    {plan.error ? "No se pudieron leer las capas: ver la consola HID." : "Leyendo capas y macros… (si el teclado duerme, apretá una tecla)"}
                  </span>
                }
              >
                <Stack gap="2" textStyle="sm">
                  <span>
                    {cleared().length ? `Estas teclas van a quedar sin asignar: ${cleared().join(", ")}.` : "No está asignada a ninguna tecla."}
                  </span>
                  <Show when={shiftedCount()}>
                    <span>
                      Las macros que vienen después bajan un número; se actualizan {shiftedCount()} teclas que las usan.
                    </span>
                  </Show>
                  <Show when={status()}>
                    <span class={muted}>{status()}</span>
                  </Show>
                </Stack>
              </Show>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" disabled={busy()} onClick={props.onClose}>
                Cancelar
              </Button>
              <Button colorPalette="red" disabled={!plan()} loading={busy()} onClick={confirm}>
                <Trash2 /> Borrar
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

export default function MacrosTab() {
  /** undefined = editor cerrado; null = macro nueva; número = regrabar esa. */
  const [editing, setEditing] = createSignal<number | null | undefined>(undefined);
  const [reading, setReading] = createSignal(false);
  /** Índice de la macro a borrar (base 1 para que 0 no se confunda con "ninguna"). */
  const [deletingSlot, setDeletingSlot] = createSignal<number | null>(null);
  const setDeleting = (i: number | null) => setDeletingSlot(i === null ? null : i + 1);

  const read = async () => {
    setReading(true);
    await run(readMacroMemory);
    setReading(false);
  };

  return (
    <Stack gap="4">
      <HStack gap="3" flexWrap="wrap">
        <Button size="sm" colorPalette="blue" loading={reading()} loadingText="Leyendo…" onClick={read}>
          <RefreshCw /> Leer macros
        </Button>
        <Button size="sm" variant="outline" disabled={!macros()} onClick={() => setEditing(null)}>
          <Plus /> Nueva macro
        </Button>
        <span class={muted}>
          {macros()
            ? `${macros()!.length} macros · ${macroMem()!.length} bytes.${layersRead() ? "" : " Leé las capas en Teclado para ver qué tecla usa cada una."}`
            : "Leé las macros para verlas. Se guardan en el teclado y las llama una tecla asignada en la pestaña Teclado."}
        </span>
      </HStack>

      <Show when={editing() !== undefined}>
        <MacroEditor index={editing()!} onClose={() => setEditing(undefined)} />
      </Show>

      {/* Fuera de la lista: la lista se redibuja al cambiar las macros y el diálogo no debe reiniciarse. */}
      <Show when={deletingSlot()} keyed>
        {(slot) => <DeleteMacro index={slot - 1} onClose={() => setDeleting(null)} />}
      </Show>

      <For each={macros() ?? []}>
        {(m, i) => (
          <Panel
            title={`${i() + 1}. ${m.name || "(sin nombre)"}`}
            description={`${m.events.length} eventos · ${m.events.reduce((t, e) => t + e.delay, 0)} ms`}
            actions={
              <HStack gap="2">
                <Button size="xs" variant="outline" onClick={() => setEditing(i())}>
                  Regrabar
                </Button>
                <Button size="xs" variant="outline" colorPalette="red" onClick={() => setDeleting(i())}>
                  <Trash2 /> Borrar
                </Button>
              </HStack>
            }
          >
            <Stack gap="3">

              <Show when={layersRead()}>
                <p class={css({ textStyle: "sm" })}>
                  {macroUsage(i()).length ? `Asignada a: ${macroUsage(i()).join(", ")}` : "No está asignada a ninguna tecla de las capas leídas."}
                </p>
              </Show>
              <Events events={m.events} />
            </Stack>
          </Panel>
        )}
      </For>
    </Stack>
  );
}
