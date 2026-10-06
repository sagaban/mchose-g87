import { For, Show } from "solid-js";
import { css, cx } from "styled-system/css";
import { describeAssignment, keyAssignment, keys, shortAssignment, type Assignment, type Key } from "~/protocol";
import { macros } from "~/state";
import AssignmentIcon, { iconFor } from "./AssignmentIcon";
import { factoryAssignment, sameAssignment } from "./keymap";
import { LAYOUT, LAYOUT_H, LAYOUT_W } from "./layout";

/** Separación entre teclas, en unidades. */
const GAP = 0.08;

const keyClass = css({
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "l2",
  bg: "gray.2",
  color: "fg.default",
  // Tamaño relativo al ancho del teclado (container query): se lee en cualquier pantalla.
  fontSize: "clamp(8px, 1.45cqw, 13px)",
  lineHeight: "1.1",
  overflow: "hidden",
  whiteSpace: "nowrap",
  cursor: "pointer",
  px: "0.5",
  transition: "background 0.1s, border-color 0.1s",
  _hover: { bg: "gray.3", borderColor: "gray.7" },
});
const baseLabel = css({ fontSize: "0.7em", color: "fg.subtle" });
const remapped = css({ bg: "amber.3", borderColor: "amber.7", color: "amber.12", _hover: { bg: "amber.4" } });
const unassigned = css({ color: "fg.subtle", borderStyle: "dashed" });
const selected = css({ bg: "blue.4", borderColor: "blue.9", color: "blue.12", _hover: { bg: "blue.5" } });

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export default function Board(props: {
  layerId: number;
  layer: Uint8Array | undefined;
  selected: Key | null;
  onSelect: (k: Key | null) => void;
}) {
  const info = (key: Key) => {
    if (!props.layer) return { text: key.label, icon: null, base: null, title: key.label, remapped: false, empty: false };
    const a: Assignment = keyAssignment(props.layer, key);
    const full = describeAssignment(a);
    // En Fn/Fn2 una tecla sin asignar no hace nada: se muestra su nombre para ubicarla.
    const empty = props.layerId !== 0 && full === "—";
    // Macro: si ya se leyeron, se muestra su nombre en vez del número.
    const macroName = a[0] === 3 && a[2] === 1 ? macros()?.[a[3]]?.name : undefined;
    return {
      text: empty ? key.label : macroName || shortAssignment(a),
      icon: empty ? null : iconFor(a),
      // En Fn/Fn2 se muestra arriba la tecla física, para saber dónde está cada función.
      base: props.layerId !== 0 && !empty ? key.label : null,
      title: `${key.label}: ${empty ? "sin asignar en esta capa" : full}${macroName ? ` ("${macroName}")` : ""}`,
      remapped: !sameAssignment(a, factoryAssignment(key, props.layerId)),
      empty,
    };
  };

  return (
    <div
      class={css({
        position: "relative",
        w: "full",
        maxW: "5xl",
        bg: "bg.default",
        borderWidth: "1px",
        borderColor: "border",
        borderRadius: "l3",
        containerType: "inline-size",
      })}
      style={{ "aspect-ratio": `${LAYOUT_W + 0.5} / ${LAYOUT_H + 0.5}` }}
    >
      <For each={keys.filter((k) => !k.hidden && LAYOUT[k.id])}>
        {(key) => {
          const p = LAYOUT[key.id];
          // Margen de 0.25u alrededor del teclado.
          return (
            <button
              type="button"
              class={cx(keyClass, info(key).remapped && remapped, info(key).empty && unassigned, props.selected === key && selected)}
              style={{
                left: pct(p.x + 0.25 + GAP / 2, LAYOUT_W + 0.5),
                top: pct(p.y + 0.25 + GAP / 2, LAYOUT_H + 0.5),
                width: pct((p.w ?? 1) - GAP, LAYOUT_W + 0.5),
                height: pct(1 - GAP, LAYOUT_H + 0.5),
              }}
              title={info(key).title}
              aria-pressed={props.selected === key}
              // Tocar de nuevo la tecla elegida la deselecciona.
              onClick={() => props.onSelect(props.selected === key ? null : key)}
            >
              <Show when={info(key).base}>
                <span class={baseLabel}>{info(key).base}</span>
              </Show>
              <Show when={info(key).icon} fallback={<span>{info(key).text}</span>}>
                {(spec) => <AssignmentIcon spec={spec()} />}
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}
