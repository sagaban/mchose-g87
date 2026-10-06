import { Keyboard, Search } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { css, cx } from "styled-system/css";
import { Grid, HStack, Stack } from "styled-system/jsx";
import { muted } from "~/components/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import * as SegmentGroup from "~/components/ui/segment-group";
import * as Tabs from "~/components/ui/tabs";
import {
  ASSIGNMENT_OPTIONS,
  HID_BY_CODE,
  MACRO_MODES,
  MOD_BY_CODE,
  modsFromEvent,
  type Assignment,
  type AssignmentOption,
} from "~/protocol";
import { macros, readMacroMemory, run } from "~/state";
import { sameAssignment } from "./keymap";

const GROUPS = [...new Set([...ASSIGNMENT_OPTIONS.map((o) => o.group), "Macros"])];

/** Pestaña y modo de macro elegidos: se recuerdan entre teclas. */
const [group, setGroup] = createSignal("Teclas");
const [macroMode, setMacroMode] = createSignal<number>(MACRO_MODES[0].mode);

const chip = css({
  h: "8",
  px: "2",
  textStyle: "xs",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "l2",
  bg: "bg.default",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  cursor: "pointer",
  _hover: { bg: "gray.3" },
});
const chipCurrent = css({ borderStyle: "dashed", borderColor: "gray.8" });
const chipChosen = css({ bg: "blue.9", borderColor: "blue.9", color: "white", _hover: { bg: "blue.10" } });

/**
 * Selector de asignación: captura desde el teclado físico (con combinaciones), buscador,
 * categorías y grilla. Incluye las macros leídas, con su modo de reproducción.
 */
export default function KeyPicker(props: {
  current: Assignment;
  chosen: Assignment | null;
  onChoose: (a: Assignment) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [capturing, setCapturing] = createSignal(false);
  const [captureNote, setCaptureNote] = createSignal("");

  const options = createMemo((): AssignmentOption[] => [
    ...ASSIGNMENT_OPTIONS,
    ...(macros() ?? []).map((m, i) => ({
      group: "Macros",
      label: `${i + 1}. ${m.name || "(sin nombre)"}`,
      value: [3, macroMode(), 1, i] as Assignment,
    })),
  ]);

  const visible = () => {
    const q = query().trim().toLowerCase();
    // Con búsqueda se filtra en todas las categorías; sin búsqueda, la pestaña elegida.
    return options().filter((o) => (q ? o.label.toLowerCase().includes(q) : o.group === group()));
  };

  // ---------- Captura ----------
  let stop: (() => void) | null = null;
  const startCapture = () => {
    setCapturing(true);
    setCaptureNote("");
    let lastMod = 0;
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      if (MOD_BY_CODE[e.code]) return void (lastMod = MOD_BY_CODE[e.code]);
      const code = HID_BY_CODE[e.code];
      stop?.();
      if (code) props.onChoose([0, modsFromEvent(e), 0, code]);
      else setCaptureNote(`"${e.code}" no se puede asignar desde acá: elegilo de la lista.`);
    };
    // Un modificador solo se toma al soltarlo, si no se apretó otra tecla mientras tanto.
    const onUp = (e: KeyboardEvent) => {
      if (MOD_BY_CODE[e.code] && MOD_BY_CODE[e.code] === lastMod) {
        stop?.();
        props.onChoose([0, lastMod, 0, 0]);
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    stop = () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      setCapturing(false);
      stop = null;
    };
  };
  onCleanup(() => stop?.());

  return (
    <Stack gap="3" borderWidth="1px" borderColor="border" borderRadius="l3" p="3">
      <HStack gap="2" flexWrap="wrap">
        <Button
          size="sm"
          variant={capturing() ? "solid" : "outline"}
          colorPalette={capturing() ? "blue" : "gray"}
          onClick={() => (capturing() ? stop?.() : startCapture())}
        >
          <Keyboard /> {capturing() ? "Escuchando… (tocá para cancelar)" : "Presioná una tecla…"}
        </Button>
        <HStack gap="2" flex="1" minW="48" position="relative">
          <Search class={css({ position: "absolute", left: "2.5", boxSize: "4", color: "fg.subtle", pointerEvents: "none" })} />
          <Input size="sm" ps="8" type="search" placeholder="Buscar (F5, vol, shift…)" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        </HStack>
      </HStack>
      <Show when={captureNote()}>
        <p class={muted}>{captureNote()}</p>
      </Show>

      <Show when={!query().trim()}>
        <Tabs.Root size="sm" variant="line" value={group()} onValueChange={(d) => setGroup(d.value)}>
          <Tabs.List>
            <For each={GROUPS}>{(g) => <Tabs.Trigger value={g}>{g}</Tabs.Trigger>}</For>
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs.Root>
      </Show>

      <Show when={group() === "Macros" && !query().trim()}>
        <SegmentGroup.Root
          size="xs"
          value={String(macroMode())}
          onValueChange={(d) => {
            if (!d.value) return;
            setMacroMode(Number(d.value));
            // Si ya había una macro elegida, se actualiza su modo.
            const c = props.chosen;
            if (c?.[0] === 3) props.onChoose([3, Number(d.value), 1, c[3]]);
          }}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items items={MACRO_MODES.map((m) => ({ value: String(m.mode), label: m.label }))} />
        </SegmentGroup.Root>
      </Show>

      <Show
        when={!(group() === "Macros" && !query().trim() && !macros())}
        fallback={
          <HStack gap="2">
            <span class={muted}>Las macros todavía no se leyeron.</span>
            <Button size="xs" variant="outline" onClick={() => run(readMacroMemory)}>
              Leer macros
            </Button>
          </HStack>
        }
      >
        <Grid gridTemplateColumns="repeat(auto-fill, minmax(76px, 1fr))" gap="1.5" maxH="52" overflowY="auto">
          <For each={visible()} fallback={<span class={muted}>Nada coincide con "{query()}".</span>}>
            {(o) => (
              <button
                type="button"
                title={`${o.label} · ${o.group}`}
                class={cx(
                  chip,
                  sameAssignment(o.value, props.current) && chipCurrent,
                  props.chosen && sameAssignment(o.value, props.chosen) && chipChosen,
                )}
                onClick={() => props.onChoose(o.value)}
              >
                {o.label}
              </button>
            )}
          </For>
        </Grid>
      </Show>
    </Stack>
  );
}
