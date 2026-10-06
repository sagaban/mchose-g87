import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { Grid, HStack, Stack } from "styled-system/jsx";
import { muted, Panel } from "~/components/common";
import { Button } from "~/components/ui/button";
import { describeAssignment, keyAssignment, keys, packets, type Assignment, type Key } from "~/protocol";
import { hasVendorChannel, layers, macros, readLayer, run } from "~/state";
import AssignmentIcon, { iconFor } from "./AssignmentIcon";

const GROUPS: { title: string; match: (a: Assignment) => boolean }[] = [
  { title: "Sistema y conexión", match: (a) => a[0] === 7 },
  { title: "Iluminación", match: (a) => a[0] === 8 },
  { title: "Multimedia", match: (a) => a[0] === 2 },
  { title: "Macros", match: (a) => a[0] === 3 },
  { title: "Teclas", match: (a) => a[0] === 0 && (a[1] !== 0 || a[3] !== 0) },
];

const kbd = css({
  fontFamily: "mono",
  fontSize: "xs",
  px: "1.5",
  py: "0.5",
  borderWidth: "1px",
  borderColor: "border",
  borderBottomWidth: "2px",
  borderRadius: "l1",
  bg: "gray.2",
  whiteSpace: "nowrap",
});

/** Fn + tecla → qué hace, según la capa Fn leída del teclado (o la de fábrica si todavía no se leyó). */
export default function Shortcuts() {
  const [reading, setReading] = createSignal(false);
  const fromDevice = () => !!layers[1];
  const assignment = (key: Key): Assignment =>
    layers[1]
      ? keyAssignment(layers[1], key)
      : ([...packets["Fn_default.KeyCode"].slice(key.keypos, key.keypos + 4)] as Assignment);

  const describe = (a: Assignment) => {
    const name = a[0] === 3 && a[2] === 1 ? macros()?.[a[3]]?.name : undefined;
    return name ? `${describeAssignment(a)} ("${name}")` : describeAssignment(a);
  };

  const rows = (match: (a: Assignment) => boolean) =>
    keys.filter((k) => !k.hidden).map((k) => ({ key: k, a: assignment(k) })).filter((r) => match(r.a));

  return (
    <Panel
      title="Atajos del teclado"
      description={
        fromDevice()
          ? "Lo que hace cada tecla con Fn, leído de tu teclado."
          : "Lo que hace cada tecla con Fn de fábrica. Leé la capa Fn para ver la de tu teclado."
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={!hasVendorChannel()}
          loading={reading()}
          onClick={async () => {
            setReading(true);
            await run(() => readLayer(1));
            setReading(false);
          }}
        >
          Leer capa Fn
        </Button>
      }
    >
      <Grid gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="6">
        <For each={GROUPS}>
          {(g) => (
            <Show when={rows(g.match).length}>
              <Stack gap="2">
                <span class={css({ fontWeight: "semibold", textStyle: "sm" })}>{g.title}</span>
                <For each={rows(g.match)}>
                  {(r) => (
                    <HStack gap="3" textStyle="sm">
                      <span class={css({ minW: "24", display: "flex", gap: "1", alignItems: "center" })}>
                        <span class={kbd}>Fn</span>+<span class={kbd}>{r.key.label}</span>
                      </span>
                      <Show when={iconFor(r.a)}>
                        {(spec) => (
                          <span class={css({ color: "fg.muted", display: "inline-flex" })}>
                            <AssignmentIcon spec={{ icon: spec().icon }} />
                          </span>
                        )}
                      </Show>
                      <span>{describe(r.a)}</span>
                    </HStack>
                  )}
                </For>
              </Stack>
            </Show>
          )}
        </For>
        <Stack gap="2">
          <span class={css({ fontWeight: "semibold", textStyle: "sm" })}>Perilla</span>
          <span class={muted}>Girar a la derecha: volumen +. Girar a la izquierda: volumen −. Apretar: mute.</span>
        </Stack>
      </Grid>
    </Panel>
  );
}
