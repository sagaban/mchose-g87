import { For, type JSX, Show, splitProps } from "solid-js";
import { css } from "styled-system/css";
import { Grid } from "styled-system/jsx";
import * as Card from "~/components/ui/card";
import { hex } from "~/protocol";

/** Tarjeta con título, descripción opcional y acciones a la derecha del título. */
export function Panel(props: {
  title?: JSX.Element;
  description?: JSX.Element;
  actions?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <Card.Root>
      <Show when={props.title || props.actions}>
        <Card.Header flexDirection="row" alignItems="center" justifyContent="space-between" gap="3" flexWrap="wrap">
          <div>
            <Card.Title>{props.title}</Card.Title>
            <Show when={props.description}>
              <Card.Description>{props.description}</Card.Description>
            </Show>
          </div>
          {props.actions}
        </Card.Header>
      </Show>
      <Card.Body>{props.children}</Card.Body>
    </Card.Root>
  );
}

/** Lista de pares etiqueta/valor. `spacious` separa más las filas (para controles, no solo texto). */
export function DataList(props: { items: [JSX.Element, JSX.Element][]; spacious?: boolean }) {
  return (
    <Grid
      as="dl"
      gridTemplateColumns="max-content 1fr"
      columnGap={props.spacious ? "8" : "6"}
      rowGap={props.spacious ? "6" : "1.5"}
      alignItems={props.spacious ? "center" : undefined}
      textStyle="sm"
    >
      <For each={props.items}>
        {([k, v]) => (
          <>
            <dt class={css({ color: "fg.muted" })}>{k}</dt>
            <dd>{v}</dd>
          </>
        )}
      </For>
    </Grid>
  );
}

export const mono = css({ fontFamily: "mono", fontSize: "xs" });
export const muted = css({ color: "fg.muted", textStyle: "sm" });

/** Volcado hexadecimal de 16 bytes por fila; `highlight` resalta offsets. */
export function HexDump(props: { data: ArrayLike<number>; base?: number; highlight?: Set<number> } & JSX.HTMLAttributes<HTMLPreElement>) {
  const [local, rest] = splitProps(props, ["data", "base", "highlight"]);
  const rows = () => {
    const out: { offset: number; bytes: number[] }[] = [];
    for (let i = 0; i < local.data.length; i += 16)
      out.push({ offset: i, bytes: Array.from({ length: Math.min(16, local.data.length - i) }, (_, j) => local.data[i + j]) });
    return out;
  };
  return (
    <pre
      class={css({
        fontFamily: "mono",
        fontSize: "xs",
        bg: "gray.2",
        borderRadius: "l2",
        p: "3",
        overflow: "auto",
        maxH: "64",
        whiteSpace: "pre",
      })}
      {...rest}
    >
      <For each={rows()}>
        {(r) => (
          <div>
            <span class={css({ color: "fg.subtle" })}>{hex((local.base ?? 0) + r.offset, 4)}</span>
            {"  "}
            <For each={r.bytes}>
              {(b, j) => (
                <>
                  <span
                    class={
                      local.highlight?.has(r.offset + j())
                        ? css({ bg: "colorPalette.subtle.bg", color: "colorPalette.fg", colorPalette: "blue", fontWeight: "semibold", borderRadius: "l1" })
                        : undefined
                    }
                  >
                    {hex(b)}
                  </span>{" "}
                </>
              )}
            </For>
          </div>
        )}
      </For>
    </pre>
  );
}
