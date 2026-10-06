import { Tooltip } from "@ark-ui/solid/tooltip";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { css } from "styled-system/css";
import { tooltip } from "styled-system/recipes";
import { shortAssignment, type Assignment } from "~/protocol";
import AssignmentIcon, { iconFor } from "./AssignmentIcon";

const styles = tooltip();
const text = css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minW: "0" });

/**
 * Opción del selector de asignación. Las que tienen ícono (multimedia, funciones del teclado) se muestran
 * con ícono y nombre corto; el nombre completo aparece en un tooltip cuando el texto no entra o se abrevió.
 */
export default function OptionChip(props: {
  label: string;
  group: string;
  value: Assignment;
  class: string;
  onClick: () => void;
}) {
  const icon = () => iconFor(props.value);
  const shown = () => (icon() ? shortAssignment(props.value) : props.label);
  const [truncated, setTruncated] = createSignal(false);
  let textEl!: HTMLSpanElement;

  return (
    <Tooltip.Root
      openDelay={250}
      closeDelay={0}
      positioning={{ placement: "top" }}
      // Solo hace falta si el texto se cortó o se muestra una versión corta.
      disabled={!truncated() && shown() === props.label}
    >
      <Tooltip.Trigger
        class={props.class}
        onClick={props.onClick}
        onPointerEnter={() => setTruncated(textEl.scrollWidth > textEl.clientWidth)}
      >
        <span class={css({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "1", minW: "0", w: "full" })}>
          <Show when={icon()}>{(spec) => <AssignmentIcon spec={{ icon: spec().icon }} />}</Show>
          <span ref={textEl} class={text}>
            {shown()}
          </span>
        </span>
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner class={styles.positioner}>
          <Tooltip.Content class={styles.content}>
            {props.label} <span class={css({ opacity: 0.7 })}>· {props.group}</span>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
