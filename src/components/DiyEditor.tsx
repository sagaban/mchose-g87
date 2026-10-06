import { Eraser, Paintbrush, SquareDashed, SquareDashedMousePointer } from "lucide-solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { css, cx } from "styled-system/css";
import { HStack, Stack } from "styled-system/jsx";
import { muted } from "~/components/common";
import { Button } from "~/components/ui/button";
import { diyColor, hexToRgb, keys, rgbToHex, withDiyColor, type Key, type Rgb } from "~/protocol";
import { device, diyColors, hasVendorChannel, run, sameBytes, setDiyColors, waking } from "~/state";
import { LAYOUT, LAYOUT_H, LAYOUT_W } from "./layout";

const GAP = 0.08;
const pct = (v: number, total: number) => `${(v / total) * 100}%`;
const KEYS = keys.filter((k) => !k.hidden && LAYOUT[k.id] && k.id !== "KEY_020000e2"); // la perilla no tiene LED

/** Texto legible sobre un color de fondo. */
const textOn = ([r, g, b]: Rgb) => (0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#111" : "#f5f5f5");

const keyClass = css({
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "l2",
  fontSize: "clamp(8px, 1.35cqw, 12px)",
  overflow: "hidden",
  whiteSpace: "nowrap",
  cursor: "pointer",
  userSelect: "none",
});
const selectedClass = css({ outline: "2px solid", outlineColor: "blue.9", outlineOffset: "2px", zIndex: 1 });

/**
 * Editor de colores por tecla (efecto Self-define): se seleccionan teclas (clic o arrastrando),
 * se pintan con un color y se guardan las tres tablas en el teclado.
 */
export default function DiyEditor() {
  /** Colores en edición (sin guardar). */
  const [draft, setDraft] = createSignal<Uint8Array | null>(diyColors());
  const [selected, setSelected] = createSignal<Set<Key>>(new Set());
  const [color, setColor] = createSignal("#ff0000");
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const dirty = () => !!draft() && !!diyColors() && !sameBytes(draft()!, diyColors()!);

  const read = async () => {
    setBusy(true);
    await run(async () => {
      const data = await device.readDiyColors(waking);
      setDiyColors(data);
      setDraft(data);
    });
    setBusy(false);
  };

  // Se leen solos al abrir el editor (sin esperar si el teclado duerme).
  onMount(() => {
    if (!diyColors() && hasVendorChannel()) read();
  });

  // Seleccionar arrastrando: con el botón apretado, pasar sobre teclas las agrega (o quita).
  let dragMode: "add" | "remove" | null = null;
  const toggle = (k: Key, mode: "add" | "remove") => {
    const next = new Set(selected());
    if (mode === "add") next.add(k);
    else next.delete(k);
    setSelected(next);
  };
  const stopDrag = () => (dragMode = null);
  window.addEventListener("pointerup", stopDrag);
  onCleanup(() => window.removeEventListener("pointerup", stopDrag));

  const paint = (rgb: Rgb) => {
    if (!draft() || !selected().size) return;
    setDraft(withDiyColor(draft()!, [...selected()], rgb));
    setStatus("");
  };

  /** Relee del teclado, aborta si cambió desde la lectura, escribe el borrador y verifica. */
  const save = async () => {
    const next = draft()!;
    const known = diyColors()!;
    setBusy(true);
    setStatus("Leyendo…");
    const result = await run(async () => {
      const fresh = await device.readDiyColors(waking);
      if (!sameBytes(fresh, known)) {
        setDiyColors(fresh);
        return "Los colores del teclado cambiaron desde que los leíste: volvé a leer.";
      }
      setStatus("Escribiendo…");
      await device.writeDiyColors(next);
      setStatus("Verificando…");
      const after = await device.readDiyColors(waking);
      setDiyColors(after);
      return sameBytes(after, next) ? "Guardado ✓" : "El teclado guardó otros valores: revisá la consola.";
    });
    setBusy(false);
    setStatus(result ?? "Error: ver la consola HID.");
  };

  return (
    <Stack gap="3" borderWidth="1px" borderColor="border" borderRadius="l3" p="3">
      <HStack justify="space-between" flexWrap="wrap" gap="2">
        <span class={css({ fontWeight: "medium", textStyle: "sm" })}>Colores por tecla</span>
        <Button size="xs" variant="outline" loading={busy() && !draft()} disabled={!hasVendorChannel()} onClick={read}>
          {draft() ? "Volver a leer" : "Leer colores"}
        </Button>
      </HStack>

      <Show when={draft()} fallback={<p class={muted}>Leé los colores del teclado para editarlos.</p>}>
        {(data) => (
          <>
            <div
              class={css({ position: "relative", w: "full", containerType: "inline-size", touchAction: "none" })}
              style={{ "aspect-ratio": `${LAYOUT_W + 0.5} / ${LAYOUT_H + 0.5}` }}
            >
              <For each={KEYS}>
                {(key) => {
                  const p = LAYOUT[key.id];
                  const rgb = () => diyColor(data(), key);
                  return (
                    <div
                      class={cx(keyClass, selected().has(key) && selectedClass)}
                      style={{
                        left: pct(p.x + 0.25 + GAP / 2, LAYOUT_W + 0.5),
                        top: pct(p.y + 0.25 + GAP / 2, LAYOUT_H + 0.5),
                        width: pct((p.w ?? 1) - GAP, LAYOUT_W + 0.5),
                        height: pct(1 - GAP, LAYOUT_H + 0.5),
                        background: rgbToHex(rgb()),
                        color: textOn(rgb()),
                      }}
                      title={`${key.label}: ${rgbToHex(rgb())}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        dragMode = selected().has(key) ? "remove" : "add";
                        toggle(key, dragMode);
                      }}
                      onPointerEnter={() => dragMode && toggle(key, dragMode)}
                    >
                      {key.label}
                    </div>
                  );
                }}
              </For>
            </div>

            <HStack gap="2" flexWrap="wrap">
              <input
                type="color"
                value={color()}
                aria-label="Color"
                onInput={(e) => setColor(e.currentTarget.value)}
                class={css({ w: "10", h: "8", p: "0.5", borderWidth: "1px", borderRadius: "l2", bg: "bg.default", cursor: "pointer" })}
              />
              <Button size="sm" colorPalette="blue" disabled={!selected().size} onClick={() => paint(hexToRgb(color()))}>
                <Paintbrush /> Pintar selección
              </Button>
              <Button size="sm" variant="outline" disabled={!selected().size} onClick={() => paint([0, 0, 0])}>
                <Eraser /> Apagar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(KEYS))}>
                <SquareDashedMousePointer /> Todas
              </Button>
              <Button size="sm" variant="outline" disabled={!selected().size} onClick={() => setSelected(new Set<Key>())}>
                <SquareDashed /> Ninguna
              </Button>
              <span class={muted}>{selected().size ? `${selected().size} seleccionadas` : "Tocá o arrastrá sobre las teclas para elegirlas."}</span>
            </HStack>

            <HStack gap="3">
              <Button size="sm" colorPalette="blue" disabled={!dirty() || busy()} loading={busy() && !!draft()} onClick={save}>
                Guardar colores
              </Button>
              <Button size="sm" variant="outline" disabled={!dirty() || busy()} onClick={() => setDraft(diyColors())}>
                Descartar cambios
              </Button>
              <span class={muted}>{status() || (dirty() ? "Hay cambios sin guardar." : "")}</span>
            </HStack>
          </>
        )}
      </Show>
    </Stack>
  );
}
