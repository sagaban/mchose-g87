import { createEffect, createSignal, For, on, Show } from "solid-js";
import { css, cx } from "styled-system/css";
import { Grid, HStack, Stack } from "styled-system/jsx";
import { muted, Panel } from "~/components/common";
import { Button } from "~/components/ui/button";
import * as RadioGroup from "~/components/ui/radio-group";
import * as Slider from "~/components/ui/slider";
import {
  AUTO_COLOR,
  ConfigOffset,
  decodeConfig,
  DEFAULT_PALETTE,
  effects,
  hexToRgb,
  LEVEL_MAX,
  palette,
  rgbToHex,
  withLight,
  withPaletteSlots,
  type Effect,
  type Rgb,
} from "~/protocol";
import { colors, config, device, hasVendorChannel, run, sameBytes, setColors, setConfig, waking } from "~/state";

/** Valores guardados de un efecto (no necesariamente el activo). */
function effectValues(cfg: Uint8Array, mode: number) {
  const copy = cfg.slice();
  copy[ConfigOffset.effect] = mode;
  return decodeConfig(copy);
}

function Level(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Slider.Root
      min={0}
      max={LEVEL_MAX}
      step={1}
      value={[props.value]}
      onValueChange={(d) => props.onChange(d.value[0])}
      colorPalette="blue"
    >
      <HStack justify="space-between">
        <Slider.Label>{props.label}</Slider.Label>
        <Slider.ValueText />
      </HStack>
      <Slider.Control>
        <Slider.Track>
          <Slider.Range />
        </Slider.Track>
        <Slider.Thumbs />
      </Slider.Control>
    </Slider.Root>
  );
}

const effectButton = css({
  textAlign: "left",
  px: "3",
  py: "2",
  borderRadius: "l2",
  textStyle: "sm",
  cursor: "pointer",
  _hover: { bg: "gray.3" },
});
const effectSelected = css({ bg: "blue.3", color: "blue.12", fontWeight: "medium", _hover: { bg: "blue.4" } });

export default function LightingTab() {
  const [selected, setSelected] = createSignal<Effect>(effects[0]);
  const [brightness, setBrightness] = createSignal(LEVEL_MAX);
  const [speed, setSpeed] = createSignal(2);
  const [source, setSource] = createSignal(0);
  const [pal, setPal] = createSignal<Rgb[]>(DEFAULT_PALETTE);
  /** Lugares de la paleta que el usuario editó: solo esos se escriben. */
  const [dirty, setDirty] = createSignal<Set<number>>(new Set());
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // Al cambiar de efecto o leer del teclado, el formulario toma los valores guardados.
  createEffect(
    on([selected, config, colors], ([fx, cfg, cols]) => {
      setStatus("");
      setDirty(new Set<number>());
      if (cfg && fx.mode) {
        const v = effectValues(cfg, fx.mode);
        setBrightness(v.brightness);
        setSpeed(v.speed);
        setSource(v.colorSource);
      }
      setPal(cols && fx.mode ? palette(cols, fx.mode) : DEFAULT_PALETTE);
    }),
  );

  const isActive = (fx: Effect) => config()?.[ConfigOffset.effect] === fx.mode;

  /** Lee, cambia solo lo de este efecto, escribe configuración y colores editados, y verifica. */
  const apply = async () => {
    const fx = selected();
    setBusy(true);
    setStatus("Leyendo configuración…");
    const result = await run(async () => {
      const cfg = await device.readConfig(waking);
      const next = withLight(cfg, {
        mode: fx.mode,
        brightness: fx.brightness ? brightness() : undefined,
        speed: fx.speed ? speed() : undefined,
        colorSource: fx.color || fx.multicolor ? source() : undefined,
      });
      setStatus("Escribiendo…");
      await device.writeConfig(next);

      let colorsOk = true;
      if (dirty().size) {
        const current = await device.readColors(waking);
        const saved = palette(current, fx.mode);
        const edited = new Map([...dirty()].filter((i) => rgbToHex(saved[i]) !== rgbToHex(pal()[i])).map((i) => [i, pal()[i]]));
        if (edited.size) {
          const nextColors = withPaletteSlots(current, fx.mode, edited);
          setStatus("Escribiendo colores…");
          await device.writeColors(nextColors);
          const after = await device.readColors(waking);
          setColors(after);
          colorsOk = sameBytes(after, nextColors);
        }
      }

      setStatus("Verificando…");
      const after = await device.readConfig(waking);
      setConfig(after);
      return colorsOk && sameBytes(after, next);
    });
    setBusy(false);
    setStatus(result === undefined ? "Error: ver la consola HID." : result ? "Aplicado ✓" : "El teclado guardó otros valores: revisá la consola.");
  };

  return (
    <Grid gridTemplateColumns={{ base: "1fr", md: "220px 1fr" }} gap="4" alignItems="start">
      <Stack gap="0.5" borderWidth="1px" borderColor="border" borderRadius="l3" p="1.5" bg="bg.default">
        <For each={effects}>
          {(fx) => (
            <button type="button" class={cx(effectButton, selected() === fx && effectSelected)} onClick={() => setSelected(fx)}>
              {fx.name}
              <Show when={isActive(fx)}>
                <span class={css({ color: "fg.subtle", ms: "2", textStyle: "xs" })}>· activo</span>
              </Show>
            </button>
          )}
        </For>
      </Stack>

      <Panel
        title={selected().name}
        description={config() ? `Modo ${selected().mode}` : "Leé la configuración en Dispositivo para ver tus valores actuales."}
      >
        <Stack gap="6">
          <Show when={selected().brightness}>
            <Level label="Brillo" value={brightness()} onChange={setBrightness} />
          </Show>
          <Show when={selected().speed}>
            <Level label="Velocidad" value={speed()} onChange={setSpeed} />
          </Show>

          <Show when={selected().color || selected().multicolor}>
            <Stack gap="3" borderWidth="1px" borderColor="border" borderRadius="l3" p="3">
              <span class={css({ fontWeight: "medium", textStyle: "sm" })}>Color</span>
              <RadioGroup.Root value={String(source())} onValueChange={(d) => d.value && setSource(Number(d.value))} colorPalette="blue">
                <Stack gap="3">
                  <HStack gap="3" flexWrap="wrap" opacity={source() === AUTO_COLOR ? 0.4 : 1}>
                    <For each={pal()}>
                      {(c, i) => (
                        <Stack gap="1.5" alignItems="center">
                          <input
                            type="color"
                            value={rgbToHex(c)}
                            disabled={!colors()}
                            aria-label={`Color ${i() + 1}`}
                            class={css({
                              w: "10",
                              h: "8",
                              p: "0.5",
                              borderWidth: "1px",
                              borderRadius: "l2",
                              bg: "bg.default",
                              cursor: "pointer",
                              borderColor: source() === i() ? "blue.9" : "border",
                              outline: source() === i() ? "2px solid" : "none",
                              outlineColor: "blue.9",
                              outlineOffset: "1px",
                              _disabled: { cursor: "not-allowed" },
                            })}
                            onInput={(e) => {
                              const next = [...pal()];
                              next[i()] = hexToRgb(e.currentTarget.value);
                              setPal(next);
                              setDirty(new Set([...dirty(), i()]));
                            }}
                          />
                          <RadioGroup.Item value={String(i())}>
                            <RadioGroup.ItemControl />
                            <RadioGroup.ItemText>{i() + 1}</RadioGroup.ItemText>
                            <RadioGroup.ItemHiddenInput />
                          </RadioGroup.Item>
                        </Stack>
                      )}
                    </For>
                  </HStack>
                  <Show when={selected().multicolor}>
                    <RadioGroup.Item value={String(AUTO_COLOR)}>
                      <RadioGroup.ItemControl />
                      <RadioGroup.ItemText>Automático (colores de todo el espectro, ignora la paleta)</RadioGroup.ItemText>
                      <RadioGroup.ItemHiddenInput />
                    </RadioGroup.Item>
                  </Show>
                </Stack>
              </RadioGroup.Root>
              <p class={muted}>
                {colors()
                  ? "Elegí con el círculo qué color usa el efecto. Podés editar los 7 y guardarlos para usarlos después."
                  : "Leé la configuración en Dispositivo para ver y editar tus colores."}
              </p>
            </Stack>
          </Show>

          <Show when={!selected().brightness && !selected().speed && !selected().color && !selected().multicolor}>
            <p class={muted}>Este efecto no tiene parámetros.</p>
          </Show>

          <HStack gap="3">
            <Button colorPalette="blue" disabled={!hasVendorChannel()} loading={busy()} onClick={apply}>
              Aplicar
            </Button>
            <span class={muted}>{status()}</span>
          </HStack>
        </Stack>
      </Panel>
    </Grid>
  );
}
