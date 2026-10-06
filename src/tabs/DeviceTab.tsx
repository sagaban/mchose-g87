import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { HStack, Stack } from "styled-system/jsx";
import { DataList, HexDump, mono, muted, Panel } from "~/components/common";
import { Button } from "~/components/ui/button";
import OsModeSwitch from "~/components/OsModeSwitch";
import Shortcuts from "~/components/Shortcuts";
import { describe, deviceLabel } from "~/hid";
import { AUTO_COLOR, configDiff, decodeConfig, hex, hexBytes, parseBattery } from "~/protocol";
import { config, conn, device, hasVendorChannel, readConfig, run, setConn, waking } from "~/state";


const table = css({
  w: "full",
  textStyle: "sm",
  "& th": { textAlign: "left", color: "fg.muted", fontWeight: "medium", py: "1.5", px: "2", borderBottomWidth: "1px" },
  "& td": { py: "1.5", px: "2", borderBottomWidth: "1px", borderColor: "border" },
});

function KeyboardState() {
  const decoded = () => (config() ? decodeConfig(config()!) : null);
  const diff = () => (config() ? configDiff(config()!) : []);
  const awakeText = () =>
    conn.awake === null ? "—" : conn.awake ? "Despierto" : "Dormido: apretá una tecla para despertarlo";
  const batteryText = () =>
    !conn.battery
      ? "Se actualiza cuando despierte"
      : conn.battery.percent === 0 && conn.battery.charging
        ? "Cargando (por cable el teclado no informa el nivel)"
        : `${conn.battery.percent} %${conn.battery.charging ? " · cargando" : ""}`;

  return (
    <Panel
      title="Estado del teclado"
      actions={
        <HStack gap="2" flexWrap="wrap">
          <Button size="sm" variant="outline" onClick={() => run(async () => setConn("battery", parseBattery(await device.readBattery(waking))))}>
            Leer batería
          </Button>
          <Button size="sm" variant="outline" onClick={() => run(async () => setConn("version", await device.readVersion(waking)))}>
            Leer versión
          </Button>
          <Button size="sm" colorPalette="blue" onClick={() => run(readConfig)}>
            Leer configuración
          </Button>
        </HStack>
      }
    >
      <Stack gap="5">
        <DataList
          items={[
            ["Teclado", awakeText()],
            ["Batería", batteryText()],
            ["Versión", <span class={mono}>{conn.version ? hexBytes(conn.version) : "—"}</span>],
            ...((decoded()
              ? [
                  ["Modo", <OsModeSwitch />],
                  ["Efecto", <>{decoded()!.effect?.name ?? "desconocido"} <span class={muted}>(modo {decoded()!.mode})</span></>],
                  ["Brillo", `${decoded()!.brightness} / 4`],
                  ["Velocidad", `${decoded()!.speed} / 4`],
                  ["Color", decoded()!.colorSource === AUTO_COLOR ? "Automático (todo el espectro)" : `Lugar ${decoded()!.colorSource + 1} de la paleta`],
                ]
              : []) as [string, any][]),
          ]}
        />
        <Show when={config()}>
          <Stack gap="2">
            <p class={muted}>
              {config()!.length} bytes de configuración. Resaltado: distinto de fábrica ({diff().length} bytes).
            </p>
            <HexDump data={config()!} highlight={new Set(diff().map((d) => d.offset))} />
            <table class={table}>
              <thead>
                <tr>
                  <th>Offset</th>
                  <th>Fábrica</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                <For each={diff()}>
                  {(d) => (
                    <tr class={mono}>
                      <td>
                        {d.offset} (0x{hex(d.offset)})
                      </td>
                      <td>{hex(d.factory)}</td>
                      <td>{hex(d.current)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Stack>
        </Show>
      </Stack>
    </Panel>
  );
}

export default function DeviceTab() {
  return (
    <Stack gap="4">
      <Show
        when={conn.devices.length}
        fallback={<p class={muted}>Conectá el teclado (por cable o con el receptor 2.4G) y tocá Conectar.</p>}
      >
        <Show when={hasVendorChannel()}>
          <KeyboardState />
        </Show>
        <Shortcuts />
        <For each={conn.devices}>
          {(d) => (
            <Panel title={deviceLabel(d)} description={<span class={mono}>VID 0x{hex(d.vendorId, 4)} · PID 0x{hex(d.productId, 4)}</span>}>
              <table class={table}>
                <thead>
                  <tr>
                    <th>Usage page / usage</th>
                    <th>Tipo</th>
                    <th>Report ID</th>
                    <th>Tamaño</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={describe(d).flatMap((c) => c.reports.map((r) => ({ c, r })))}>
                    {({ c, r }) => (
                      <tr>
                        <td class={mono}>
                          0x{hex(c.usagePage, 4)} / 0x{hex(c.usage)}
                        </td>
                        <td>{r.kind}</td>
                        <td class={mono}>0x{hex(r.id)}</td>
                        <td>{r.size} bytes</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Panel>
          )}
        </For>
      </Show>
    </Stack>
  );
}
