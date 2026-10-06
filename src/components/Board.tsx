import { For } from "solid-js";
import { css, cx } from "styled-system/css";
import { describeAssignment, keyAssignment, keys, type Assignment, type Key } from "~/protocol";
import { factoryAssignment, sameAssignment } from "./keymap";

// Lienzo del XML oficial: ~640×290.
const W = 640;
const H = 290;

const keyClass = css({
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "l2",
  bg: "gray.2",
  color: "fg.default",
  fontSize: "clamp(7px, 1.35cqw, 12px)",
  lineHeight: "1.1",
  overflow: "hidden",
  whiteSpace: "nowrap",
  cursor: "pointer",
  transition: "background 0.1s, border-color 0.1s",
  _hover: { bg: "gray.3", borderColor: "gray.7" },
});

const remapped = css({ bg: "amber.3", borderColor: "amber.7", color: "amber.12", _hover: { bg: "amber.4" } });
const unassigned = css({ color: "fg.subtle", borderStyle: "dashed" });
const selected = css({ bg: "blue.4", borderColor: "blue.9", color: "blue.12", _hover: { bg: "blue.5" } });

export default function Board(props: {
  layerId: number;
  layer: Uint8Array | undefined;
  selected: Key | null;
  onSelect: (k: Key) => void;
}) {
  const info = (key: Key) => {
    if (!props.layer) return { text: key.label, title: key.id, remapped: false, empty: false };
    const a: Assignment = keyAssignment(props.layer, key);
    // En el dibujo no entran los nombres largos de modificadores: versión corta.
    const text = describeAssignment(a).replace("Alt ⌥", "⌥").replace("Win ⌘", "⌘").replaceAll(" der.", " R");
    // En Fn/Fn2 una tecla sin asignar no hace nada: se muestra su nombre para ubicarla.
    const empty = props.layerId !== 0 && text === "—";
    return {
      text: empty ? key.label : text,
      title: `${key.label}: ${empty ? "sin asignar en esta capa" : text}`,
      remapped: !sameAssignment(a, factoryAssignment(key, props.layerId)),
      empty,
    };
  };

  return (
    <div
      class={css({
        position: "relative",
        w: "full",
        maxW: "4xl",
        aspectRatio: "640 / 290",
        bg: "bg.default",
        borderWidth: "1px",
        borderColor: "border",
        borderRadius: "l3",
        containerType: "inline-size",
      })}
    >
      <For each={keys.filter((k) => !k.hidden)}>
        {(key) => (
          <button
            type="button"
            class={cx(
              keyClass,
              info(key).remapped && remapped,
              info(key).empty && unassigned,
              props.selected === key && selected,
            )}
            style={{
              left: `${(key.x / W) * 100}%`,
              top: `${(key.y / H) * 100}%`,
              width: `${(key.w / W) * 100}%`,
              height: `${(key.h / H) * 100}%`,
            }}
            title={info(key).title}
            onClick={() => props.onSelect(key)}
          >
            {info(key).text}
          </button>
        )}
      </For>
    </div>
  );
}
