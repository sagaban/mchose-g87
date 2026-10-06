import { For, Show } from "solid-js";
import { Stack } from "styled-system/jsx";
import { DataList, HexDump, mono, muted, Panel } from "~/components/common";
import { hex, packetNames, packets, parseHeader } from "~/protocol";

export default function PacketsTab() {
  return (
    <Stack gap="4">
      <p class={muted}>
        Paquetes por defecto del instalador oficial (G87_data.ini), en el formato del modo por cable: report ID, comando,
        argumento y longitud útil.
      </p>
      <For each={Object.entries(packetNames)}>
        {([key, name]) => (
          <Show when={packets[key]}>
            {(p) => {
              const h = parseHeader(p());
              return (
                <Panel title={name} description={<span class={mono}>{key}</span>}>
                  <Stack gap="3">
                    <DataList
                      items={[
                        ["Report ID", <span class={mono}>0x{hex(h.reportId)}</span>],
                        ["Comando", <span class={mono}>0x{hex(h.command)}</span>],
                        ["Argumento", <span class={mono}>0x{hex(h.arg, 4)}</span>],
                        ["Longitud", `${h.length} bytes (paquete total ${p().length})`],
                      ]}
                    />
                    <HexDump data={p().slice(8, 8 + h.length)} base={8} />
                  </Stack>
                </Panel>
              );
            }}
          </Show>
        )}
      </For>
    </Stack>
  );
}
