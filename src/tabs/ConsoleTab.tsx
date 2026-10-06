import { Copy, Send, Trash2 } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { css } from "styled-system/css";
import { HStack, Stack } from "styled-system/jsx";
import { muted, Panel } from "~/components/common";
import { Button } from "~/components/ui/button";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as SegmentGroup from "~/components/ui/segment-group";
import * as Switch from "~/components/ui/switch";
import type { LogEntry } from "~/hid";
import { hex, hexBytes, parseHexInput } from "~/protocol";
import { hid, log, run, setLog } from "~/state";

const ARROWS: Record<LogEntry["dir"], string> = {
  in: "←",
  out: "→",
  "feature-get": "⇠",
  "feature-set": "⇢",
  info: "·",
  error: "!",
};

const COLORS: Record<LogEntry["dir"], string> = {
  in: css({ color: "green.11" }),
  out: css({ color: "red.11" }),
  "feature-set": css({ color: "red.11" }),
  "feature-get": css({ color: "blue.11" }),
  info: css({ color: "fg.muted" }),
  error: css({ color: "red.11", fontWeight: "semibold" }),
};

const line = (e: LogEntry) => {
  const rid = e.reportId !== undefined ? ` [0x${hex(e.reportId)}]` : "";
  return `${e.time.toTimeString().slice(0, 8)} ${ARROWS[e.dir]} ${e.dir}${rid} ${e.data ? hexBytes(e.data) : e.text ?? ""}`;
};

const parseId = (s: string) => {
  const n = parseInt(s.replace(/^0x/i, ""), 16);
  if (!(n >= 0 && n <= 0xff)) throw new Error(`Report ID inválido: "${s}"`);
  return n;
};

export default function ConsoleTab() {
  const [readId, setReadId] = createSignal("06");
  const [writeEnabled, setWriteEnabled] = createSignal(false);
  const [kind, setKind] = createSignal("output");
  const [sendId, setSendId] = createSignal("13");
  const [bytes, setBytes] = createSignal("");
  // Enviar exige dos clics: el primero "arma" el botón por 4 s.
  const [armed, setArmed] = createSignal(false);
  let armTimer: number | undefined;
  const disarm = () => {
    clearTimeout(armTimer);
    setArmed(false);
  };
  onCleanup(disarm);

  const send = () => {
    if (!armed()) {
      setArmed(true);
      armTimer = window.setTimeout(disarm, 4000);
      return;
    }
    disarm();
    run(async () => {
      const id = parseId(sendId());
      const data = parseHexInput(bytes());
      if (kind() === "feature") await hid.sendFeature(id, data);
      else await hid.sendOutput(id, data);
    });
  };

  let logEl!: HTMLPreElement;
  // Bajar al final cuando llegan entradas nuevas.
  createEffect(() => {
    log();
    queueMicrotask(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
  });

  return (
    <Stack gap="4">
      <Panel title="Leer (seguro)" description="Un GET_REPORT pide datos al teclado sin modificar nada.">
        <HStack gap="3" alignItems="end">
          <Field.Root w="40">
            <Field.Label>Feature report ID</Field.Label>
            <Input size="sm" value={readId()} onInput={(e) => setReadId(e.currentTarget.value)} />
          </Field.Root>
          <Button size="sm" variant="outline" onClick={() => run(() => hid.readFeature(parseId(readId())))}>
            Leer feature report
          </Button>
        </HStack>
      </Panel>

      <Panel title="Enviar (riesgoso)" description="Manda bytes crudos. Nunca mandes comandos de firmware.">
        <Stack gap="4">
          <Switch.Root
            checked={writeEnabled()}
            onCheckedChange={(d) => {
              setWriteEnabled(d.checked);
              disarm();
            }}
          >
            <Switch.Control />
            <Switch.Label>Habilitar escritura al teclado</Switch.Label>
            <Switch.HiddenInput />
          </Switch.Root>
          <HStack gap="3" alignItems="end" flexWrap="wrap" opacity={writeEnabled() ? 1 : 0.4} pointerEvents={writeEnabled() ? "auto" : "none"}>
            <SegmentGroup.Root size="sm" value={kind()} onValueChange={(d) => d.value && setKind(d.value)}>
              <SegmentGroup.Indicator />
              <SegmentGroup.Items items={[{ value: "output", label: "Output" }, { value: "feature", label: "Feature" }]} />
            </SegmentGroup.Root>
            <Field.Root w="28">
              <Field.Label>Report ID</Field.Label>
              <Input size="sm" value={sendId()} onInput={(e) => setSendId(e.currentTarget.value)} />
            </Field.Root>
            <Field.Root flex="1" minW="64">
              <Field.Label>Bytes (hex)</Field.Label>
              <Input size="sm" placeholder="00 00 00 …" value={bytes()} onInput={(e) => setBytes(e.currentTarget.value)} />
            </Field.Root>
            <Button size="sm" colorPalette={armed() ? "red" : "gray"} variant={armed() ? "solid" : "outline"} onClick={send}>
              <Send /> {armed() ? "Confirmar envío" : "Enviar"}
            </Button>
          </HStack>
          <p class={muted}>Hay que tocar Enviar dos veces para confirmar.</p>
        </Stack>
      </Panel>

      <Panel
        title="Log"
        description={`${log().length} entradas`}
        actions={
          <HStack gap="2">
            <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(log().map(line).join("\n"))}>
              <Copy /> Copiar
            </Button>
            <Button size="xs" variant="outline" onClick={() => setLog([])}>
              <Trash2 /> Limpiar
            </Button>
          </HStack>
        }
      >
        <pre
          ref={logEl}
          class={css({
            fontFamily: "mono",
            fontSize: "xs",
            bg: "gray.2",
            borderRadius: "l2",
            p: "3",
            h: "96",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          })}
        >
          <For each={log()}>{(e) => <div class={COLORS[e.dir]}>{line(e)}</div>}</For>
        </pre>
      </Panel>
    </Stack>
  );
}
