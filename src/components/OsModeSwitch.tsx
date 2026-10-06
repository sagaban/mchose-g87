import { createSignal } from "solid-js";
import { HStack } from "styled-system/jsx";
import { muted } from "~/components/common";
import * as SegmentGroup from "~/components/ui/segment-group";
import { ConfigOffset, OS_MODES } from "~/protocol";
import { config, run, updateConfig } from "~/state";

/** Selector de modo Windows/Mac: cambia solo el byte del modo, escribe y verifica (igual que Fn+W / Fn+E). */
export default function OsModeSwitch(props: { hint?: boolean }) {
  const [status, setStatus] = createSignal("");
  const change = async (value: number) => {
    setStatus("Aplicando…");
    const result = await run(() =>
      updateConfig((c) => {
        c[ConfigOffset.osMode] = value;
        // Como el driver oficial: en modo Mac la tecla Win no se puede bloquear.
        if (value === 2) c[ConfigOffset.winLock] = 0;
      }),
    );
    setStatus(result === undefined ? "Error: ver la consola HID." : result ? "" : "El teclado guardó otro valor.");
  };
  return (
    <HStack gap="3">
      <SegmentGroup.Root
        size="xs"
        value={String(config()![ConfigOffset.osMode])}
        onValueChange={(d) => d.value && change(Number(d.value))}
      >
        <SegmentGroup.Indicator />
        <SegmentGroup.Items items={OS_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
      </SegmentGroup.Root>
      <span class={muted}>{status() || (props.hint === false ? "" : "Igual que Fn+W / Fn+E.")}</span>
    </HStack>
  );
}
