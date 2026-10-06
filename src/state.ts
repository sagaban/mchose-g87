// Estado compartido de la app: conexión, datos leídos del teclado y log.
// Los datos del teclado se guardan como Uint8Array inmutables: cada lectura reemplaza el valor.
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { Hid, VENDOR_REPORT, type LogEntry } from "./hid";
import {
  Cmd,
  MACRO_PAGE,
  macroMemoryEnd,
  parseBattery,
  parseMacros,
  parseNotice,
  type Battery,
  type Macro,
} from "./protocol";

export const hid = new Hid();

export const [conn, setConn] = createStore({
  /** Interfaces abiertas. */
  devices: [] as HIDDevice[],
  /** Se perdió la conexión sin que el usuario desconectara: hay que volver a autorizar. */
  lost: false,
  /** null = todavía no se sabe. */
  awake: null as boolean | null,
  /** Mensaje mientras se espera que el teclado despierte. */
  waiting: false,
  battery: null as Battery | null,
  version: null as Uint8Array | null,
});

export const connected = () => conn.devices.length > 0;
export const hasVendorChannel = () => conn.devices.length > 0 && !!hid.find("output", VENDOR_REPORT);

/** Configuración (0x44), paletas (0x49), capas del mapa de teclas (0x41) y macros (0x43). */
export const [config, setConfig] = createSignal<Uint8Array | null>(null);
export const [colors, setColors] = createSignal<Uint8Array | null>(null);
export const [layers, setLayers] = createStore<Record<number, Uint8Array | undefined>>({});
export const [macroMem, setMacroMem] = createSignal<Uint8Array | null>(null);
export const macros = (): Macro[] | null => {
  const mem = macroMem();
  return mem ? parseMacros(mem) : null;
};

// ---------- Log ----------

const LOG_MAX = 1000;
export const [log, setLog] = createSignal<LogEntry[]>([]);

export function appendLog(e: LogEntry) {
  setLog((l) => (l.length >= LOG_MAX ? [...l.slice(-LOG_MAX + 1), e] : [...l, e]));
}

export const logError = (e: unknown) =>
  appendLog({ time: new Date(), dir: "error", text: e instanceof Error ? e.message : String(e) });

/** Corre una operación con el teclado; los errores van al log y se devuelve undefined. */
export async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    logError(e);
    return undefined;
  } finally {
    syncDevices();
  }
}

// ---------- Teclado dormido ----------

/** Opciones para pedidos que pueden tener que esperar a que el teclado despierte. */
export const waking = { onSlow: () => setConn("waiting", true) };

function setAwake(awake: boolean) {
  batch(() => {
    setConn("awake", awake);
    if (awake) setConn("waiting", false);
  });
}

hid.onLog((e) => {
  appendLog(e);
  if (e.dir !== "in" || e.reportId !== VENDOR_REPORT || !e.data) return;
  const n = parseNotice(e.data);
  if (!n) return setAwake(true); // cualquier respuesta prueba que está despierto
  if (n.kind === "awake") {
    setAwake(n.awake);
    if (n.awake) refreshBattery();
  }
  if (n.kind === "battery") setConn("battery", n.battery);
});

// ---------- Conexión ----------

function syncDevices() {
  batch(() => {
    setConn("devices", [...hid.devices]);
    setConn("lost", hid.lost);
    if (!hid.devices.length) {
      setConn("battery", null);
      setConn("awake", null);
      setConn("waiting", false);
    }
  });
}

let batteryPending = false;

/** Consulta 0x4A. Silenciosa: si el teclado duerme, se reintenta cuando avise que despertó. */
export async function refreshBattery({ timeoutMs = 5000 } = {}) {
  if (batteryPending || !hasVendorChannel()) return;
  batteryPending = true;
  try {
    setConn("battery", parseBattery(await hid.query(Cmd.battery, 0x01, { timeoutMs })));
  } catch {
    if (connected()) setConn("awake", false);
  } finally {
    batteryPending = false;
  }
}

export const connect = () => run(() => hid.request()).then(() => refreshBattery());
export const disconnect = () => run(() => hid.close());

if (hid.supported) {
  hid.watch(() => {
    syncDevices();
    if (hid.devices.length) refreshBattery();
  });
  run(() => hid.restore()).then(() => refreshBattery());
}

// ---------- Lecturas ----------

export const readConfig = async () => {
  const [cfg, pal] = [await hid.query(Cmd.config, 0x01, waking), await hid.query(Cmd.colors, 0x01, waking)];
  batch(() => {
    setConfig(cfg);
    setColors(pal.slice(0, 490));
  });
};

export const readLayer = async (layer: number) => {
  // La respuesta trae la capa en el nibble alto del largo: solo se aceptan pedazos de esta capa.
  const data = await hid.query(Cmd.keymap, 0x01, { ...waking, args: [0x00, layer << 4], accept: (b) => b[3] >> 4 === layer });
  setLayers(layer, data);
  return data;
};

/** Lee las páginas necesarias de la memoria de macros (la tabla dice hasta dónde hay datos), sin tocar el estado. */
export async function fetchMacroMemory() {
  const page = (n: number) => hid.query(Cmd.macros, 0x01, { ...waking, args: [0x00, n << 4] });
  let mem = await page(0);
  const end = macroMemoryEnd(mem);
  for (let n = 1; n * MACRO_PAGE < end; n++) mem = new Uint8Array([...mem, ...(await page(n))]);
  return mem.slice(0, end);
}

/** Lee la memoria de macros y la guarda en el estado (solo si cambió, para no redibujar la lista). */
export async function readMacroMemory() {
  const mem = await fetchMacroMemory();
  const known = macroMem();
  if (!known || !sameBytes(known, mem)) setMacroMem(mem);
  return mem;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
