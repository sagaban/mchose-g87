import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Keyboard, Moon, Plug, RefreshCw, Unplug } from "lucide-solid";
import { createSignal, Match, Show, Switch } from "solid-js";
import { css } from "styled-system/css";
import { Box, Container, HStack, Stack } from "styled-system/jsx";
import * as Alert from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import * as Tabs from "~/components/ui/tabs";
import { conn, connect, connected, disconnect, hasVendorChannel, hid, readConfig, run } from "./state";

/** Lee configuración y paletas del teclado (lo que usan Dispositivo e Iluminación). */
function ReadButton() {
  const [busy, setBusy] = createSignal(false);
  return (
    <Show when={hasVendorChannel()}>
      <Button
        size="sm"
        variant="outline"
        loading={busy()}
        title="Leer configuración y colores del teclado"
        onClick={async () => {
          setBusy(true);
          await run(() => readConfig());
          setBusy(false);
        }}
      >
        <RefreshCw /> Leer del teclado
      </Button>
    </Show>
  );
}
import ConsoleTab from "./tabs/ConsoleTab";
import DeviceTab from "./tabs/DeviceTab";
import KeyboardTab from "./tabs/KeyboardTab";
import LightingTab from "./tabs/LightingTab";
import MacrosTab from "./tabs/MacrosTab";
import PacketsTab from "./tabs/PacketsTab";

function BatteryBadge() {
  const icon = () => {
    const b = conn.battery!;
    if (b.charging) return <BatteryCharging />;
    if (b.percent <= 15) return <BatteryLow />;
    if (b.percent <= 60) return <BatteryMedium />;
    return <BatteryFull />;
  };
  return (
    <Show when={conn.battery}>
      <Badge
        variant="outline"
        size="lg"
        colorPalette={conn.battery!.percent <= 15 && !conn.battery!.charging ? "red" : "gray"}
        title={conn.battery!.charging ? "Cargando" : "A batería"}
      >
        {icon()}
        {/* Por cable el teclado informa 0 %: solo se sabe que está cargando. */}
        {conn.battery!.percent === 0 && conn.battery!.charging ? "Cargando" : `${conn.battery!.percent} %`}
      </Badge>
    </Show>
  );
}

function StatusBadge() {
  return (
    <Switch>
      <Match when={!connected()}>
        <Badge variant="outline" size="lg">
          Desconectado
        </Badge>
      </Match>
      <Match when={conn.awake === false}>
        <Badge variant="subtle" size="lg" colorPalette="gray" title="Apretá una tecla para despertarlo">
          <Moon /> Dormido
        </Badge>
      </Match>
      <Match when={true}>
        <Badge variant="subtle" size="lg" colorPalette="green">
          {conn.devices[0]?.productName ?? "Conectado"}
        </Badge>
      </Match>
    </Switch>
  );
}

const TABS = [
  { value: "device", label: "Dispositivo", content: DeviceTab },
  { value: "keyboard", label: "Teclado", content: KeyboardTab },
  { value: "lighting", label: "Iluminación", content: LightingTab },
  { value: "macros", label: "Macros", content: MacrosTab },
  { value: "packets", label: "Paquetes", content: PacketsTab },
  { value: "console", label: "Consola HID", content: ConsoleTab },
];

export default function App() {
  return (
    <Box minH="100vh" bg="gray.1" color="fg.default">
      <Box borderBottomWidth="1px" borderColor="border" bg="bg.default">
        <Container maxW="6xl" py="3">
          <HStack gap="3" justify="space-between" flexWrap="wrap">
            <HStack gap="2">
              <Keyboard class={css({ color: "colorPalette.solid.bg", colorPalette: "blue" })} />
              <Heading as="h1" textStyle="lg">
                MCHOSE G87
              </Heading>
            </HStack>
            <HStack gap="2" flexWrap="wrap">
              <BatteryBadge />
              <StatusBadge />
              <ReadButton />
              <Show
                when={connected()}
                fallback={
                  <Button size="sm" colorPalette="blue" onClick={connect} disabled={!hid.supported}>
                    <Plug /> Conectar
                  </Button>
                }
              >
                <Button size="sm" variant="outline" onClick={disconnect}>
                  <Unplug /> Desconectar
                </Button>
              </Show>
            </HStack>
          </HStack>
        </Container>
      </Box>

      <Container maxW="6xl" py="5">
        <Stack gap="4">
          <Show when={!hid.supported}>
            <Alert.Root colorPalette="red">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Este navegador no soporta WebHID</Alert.Title>
                <Alert.Description>Usá Chrome, Edge, Brave u Opera de escritorio.</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          </Show>

          <Show when={conn.lost && !connected()}>
            <Alert.Root colorPalette="amber">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Se perdió la conexión con el teclado</Alert.Title>
                <Alert.Description>
                  El receptor se desconectó o se reinició, y Chrome necesita que lo vuelvas a autorizar. Si estabas
                  aplicando un cambio, volvé a aplicarlo después de conectar.
                </Alert.Description>
              </Alert.Content>
              <Button size="sm" colorPalette="blue" onClick={connect}>
                Volver a conectar
              </Button>
            </Alert.Root>
          </Show>

          <Show when={conn.waiting}>
            <Alert.Root colorPalette="blue">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Esperando al teclado</Alert.Title>
                <Alert.Description>Está dormido: apretá cualquier tecla para despertarlo.</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          </Show>

          <Tabs.Root defaultValue="device" lazyMount>
            <Tabs.List>
              {TABS.map((t) => (
                <Tabs.Trigger value={t.value}>{t.label}</Tabs.Trigger>
              ))}
              <Tabs.Indicator />
            </Tabs.List>
            {TABS.map((t) => (
              <Tabs.Content value={t.value} pt="4">
                <t.content />
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Stack>
      </Container>
    </Box>
  );
}
