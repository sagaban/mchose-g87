// Lo que se sabe (o se sospecha) del protocolo, sacado de los archivos del instalador.
// Todo lo marcado como hipótesis hay que confirmarlo contra el teclado real.
import data from "./data/g87.json";

export interface Key {
  id: string;
  label: string;
  code: number;
  x: number;
  y: number;
  w: number;
  h: number;
  keypos: number;
  diypos: number;
  effectpos: number;
  hidden?: boolean;
}

export interface Effect {
  nameCode: number;
  name: string;
  mode: number;
  brightness: boolean;
  speed: boolean;
  color: boolean;
  multicolor: boolean;
}

export const keys = data.keys as Key[];
export const effects = data.effects as Effect[];
export const params = data.params;
export const step = data.step;
export const packets = data.packets as Record<string, number[]>;

/** Nombre legible de cada paquete por defecto guardado en G87_data.ini. */
export const packetNames: Record<string, string> = {
  "KeyboradConfig.Config": "Configuración general",
  "Fn_default.KeyCode": "Mapa de teclas, capa Fn",
  "DiyColorMap.coloMap": "Colores por tecla (modo personalizado)",
  "BaseColorMap.coloMap": "Colores base de iluminación",
};

export interface PacketHeader {
  reportId: number;
  command: number;
  arg: number;
  unknown: number;
  length: number;
}

/**
 * Hipótesis de cabecera (8 bytes) de los paquetes de 520 bytes:
 *   [0] report ID (0x06)  [1] comando  [2..3] argumento LE (¿capa/página?)
 *   [4..5] ¿siempre 0x0001?  [6..7] longitud útil LE
 * Encaja con los 4 paquetes: 0x84→128, 0x83→504, 0x86→384, 0x8A→512 bytes.
 */
export function parseHeader(p: number[]): PacketHeader {
  return {
    reportId: p[0],
    command: p[1],
    arg: p[2] | (p[3] << 8),
    unknown: p[4] | (p[5] << 8),
    length: p[6] | (p[7] << 8),
  };
}

export const hex = (n: number, w = 2) => n.toString(16).padStart(w, "0").toUpperCase();
export const hexBytes = (b: ArrayLike<number>) => Array.from(b, (x) => hex(x)).join(" ");

export function parseHexInput(s: string): Uint8Array {
  const parts = s
    .replace(/0x/gi, "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const bytes = parts.map((p) => {
    if (!/^[0-9a-f]{1,2}$/i.test(p)) throw new Error(`Byte inválido: "${p}"`);
    return parseInt(p, 16);
  });
  return new Uint8Array(bytes);
}

/** Bytes de un paquete por defecto en el offset que el XML asigna a una tecla. */
export function keyBytes(key: Key) {
  const slice = (name: string, pos: number, n: number) => packets[name]?.slice(pos, pos + n) ?? [];
  return {
    fnKeycode: slice("Fn_default.KeyCode", key.keypos, 4),
    diyColor: slice("DiyColorMap.coloMap", key.diypos, 3),
    baseColor: slice("BaseColorMap.coloMap", key.effectpos, 3),
  };
}

/** KeyValue del XML: 0xTTMMxxCC → tipo, modificadores, código HID. */
export function decodeKeyValue(v: number) {
  return { type: (v >>> 24) & 0xff, modifiers: (v >>> 16) & 0xff, code: v & 0xff };
}

// ---------- Canal vendor 0x13 (modo dongle) ----------

/**
 * Comandos del canal vendor. Lectura = [cmd, 0x01]; escritura = bloque en pedazos de 14 bytes.
 * Confirmados contra el teclado: version, config. El resto según
 * github.com/HoanNguyen1711/mchose-g87-controller-ubuntu (sacado del driver web oficial).
 */
export const Cmd = {
  version: 0x05,
  config: 0x44, // lee el bloque de 128 bytes (= KeyboradConfig, 0x84 por cable)
  setConfig: 0x04,
  colors: 0x49, // paleta: 7 colores RGB por efecto en 21·modo, 490 bytes
  setColors: 0x09,
  battery: 0x4a, // [nivel %][estado]
  keymap: 0x41, // args [0x00, capa<<4]; 4 bytes por tecla (= paquete 0x83 por cable)
  setKeymap: 0x01, // byte de largo = capa<<4 | largo
  diyColors: 0x42, // colores por tecla: 378 bytes (R, G, B de 126)
  setDiyColors: 0x02,
  macros: 0x43, // args [0x00, página<<4]; páginas de 512 bytes de la memoria de macros
  setMacros: 0x03, // una tanda por página de 512 (índice desde 0), byte de largo = página<<4 | largo
} as const;

/** Aviso asincrónico: [0a][01][00][04][tipo][valor][extra]… */
export type Notice =
  | { kind: "awake"; awake: boolean }
  | { kind: "battery"; battery: Battery }
  | { kind: "lighting" }
  | { kind: "unknown"; raw: Uint8Array };

export function parseNotice(b: Uint8Array): Notice | null {
  if (b[0] !== 0x0a) return null;
  switch (b[4]) {
    case 0x02:
      return { kind: "awake", awake: b[5] === 1 };
    case 0x05: // mismos 2 bytes que la respuesta de 0x4A
      return { kind: "battery", battery: parseBattery(b.slice(5, 7)) };
    case 0x07:
      return { kind: "lighting" };
    default:
      return { kind: "unknown", raw: b };
  }
}

/** Offsets del bloque de configuración que difieren del valor de fábrica. */
export function configDiff(current: Uint8Array) {
  const factory = packets["KeyboradConfig.Config"].slice(8, 8 + 128);
  return [...current].flatMap((v, i) => (v !== factory[i] ? [{ offset: i, factory: factory[i], current: v }] : []));
}

/**
 * Bloque de configuración (128 bytes, comando 0x44 / 0x84). Confirmado contra el teclado:
 *   [10]              efecto activo (= ModelCode del XML)
 *   [0x38 + 2·n]      brillo del efecto n (0–4)
 *   [0x38 + 2·n + 1]  nibble alto: velocidad (0–4) · nibble bajo: origen del color
 *                     (0–6 = ese lugar de la paleta, 7 = colores automáticos de todo el espectro)
 */
/**
 * Offsets del bloque de configuración. Nombres según el driver web oficial (rateVal, latencySwitch, lightType,
 * lightMode, winKeySwitch, sleepTimeVal, macSwitch); los confirmados contra el teclado son effect, osMode y los pares.
 */
export const ConfigOffset = {
  pollingRate: 1,
  latency: 3,
  lightType: 9,
  effect: 10,
  winLock: 15,
  sleep: 24,
  osMode: 27,
  effectParams: 0x38,
} as const;

/** Tasa de sondeo (offset 1): 1 = 250 Hz, 2 = 500 Hz, 3 = 1000 Hz. */
export const POLLING_RATES = [
  { value: 1, label: "250 Hz" },
  { value: 2, label: "500 Hz" },
  { value: 3, label: "1000 Hz" },
] as const;

/** Modo Top Speed / baja latencia (offset 3): 0 = activado, 2 = estándar (valores del G87 en el driver oficial). */
export const LATENCY = { on: 0, off: 2 } as const;

/** Suspensión (offset 24): minutos × 2, de 0,5 a 20 min; 0 = nunca se duerme. */
export const sleepMinutes = (value: number) => value / 2;
export const sleepValue = (minutes: number) => Math.round(Math.max(0, Math.min(20, minutes)) * 2);

/**
 * Modo del sistema (byte 27 de la configuración; Fn+W / Fn+E). Confirmado contra el teclado: cambiar de modo
 * solo cambia este byte; el firmware aplica el intercambio Win/Alt y las F1–F12 al vuelo, sin tocar las capas.
 */
export const OS_MODES = [
  { value: 0, label: "Windows" },
  { value: 2, label: "Mac" },
] as const;

export const osModeName = (cfg: Uint8Array) =>
  OS_MODES.find((m) => m.value === cfg[ConfigOffset.osMode])?.label ?? `desconocido (${cfg[ConfigOffset.osMode]})`;

export function withOsMode(cfg: Uint8Array, value: number) {
  const out = cfg.slice();
  out[ConfigOffset.osMode] = value;
  return out;
}

/**
 * Brillo de los efectos con color por tecla: va aparte, en el offset 96 + modo (confirmado con Self-define, modo 21:
 * offset 117, escala 0–4, cambia con Fn+↑/↓). El par de parámetros de ese modo no se usa para el brillo.
 */
export const diyBrightnessOffset = (mode: number) => 96 + mode;

export function decodeConfig(cfg: Uint8Array) {
  const mode = cfg[ConfigOffset.effect];
  const at = ConfigOffset.effectParams + 2 * mode;
  return {
    effect: effects.find((e) => e.mode === mode) ?? null,
    mode,
    brightness: DIY_MODES.includes(mode) ? cfg[diyBrightnessOffset(mode)] : cfg[at],
    speed: cfg[at + 1] >> 4,
    colorSource: cfg[at + 1] & 0x0f,
  };
}

export const LEVEL_MAX = 4;
/** Origen de color 7: el efecto genera colores de todo el espectro e ignora la paleta. */
export const AUTO_COLOR = 7;

export interface LightChange {
  mode: number;
  brightness?: number;
  speed?: number;
  /** 0–6: lugar de la paleta; AUTO_COLOR: colores automáticos. */
  colorSource?: number;
}

/** Copia del bloque con el efecto activo cambiado; solo toca los bytes de ese efecto. */
export function withLight(cfg: Uint8Array, change: LightChange) {
  const out = cfg.slice();
  const clamp = (n: number) => Math.max(0, Math.min(LEVEL_MAX, n));
  out[ConfigOffset.effect] = change.mode;
  // Los efectos con color por tecla (19, 21) van con lightType = 1; el resto, 0 (como el driver oficial).
  out[ConfigOffset.lightType] = DIY_MODES.includes(change.mode) ? 1 : 0;
  const at = ConfigOffset.effectParams + 2 * change.mode;
  if (change.mode === 0) return out; // "Off" no tiene parámetros
  if (DIY_MODES.includes(change.mode)) {
    if (change.brightness !== undefined) out[diyBrightnessOffset(change.mode)] = clamp(change.brightness);
    return out;
  }
  if (change.brightness !== undefined) out[at] = clamp(change.brightness);
  const speed = change.speed !== undefined ? clamp(change.speed) : out[at + 1] >> 4;
  const source = change.colorSource ?? out[at + 1] & 0x0f;
  out[at + 1] = (speed << 4) | (source & 0x0f);
  return out;
}

// ---------- Paletas de color (comandos 0x49 / 0x09) ----------

/** 23 efectos × 7 colores RGB (21 bytes) + 7 bytes finales que no son colores. */
export const COLOR_LEN = 490;
export const PALETTE_BYTES = 21;
/**
 * Cola que el driver web agrega a cada escritura de colores (con la marca 5A A5).
 * El último pedazo se manda con el largo sin los ceros finales.
 */
export const COLOR_TAIL = new Uint8Array([...new Array(16).fill(0), 0x5a, 0xa5, ...new Array(10).fill(0)]);

export type Rgb = [number, number, number];

export function palette(colors: Uint8Array, mode: number): Rgb[] {
  const at = PALETTE_BYTES * mode;
  return Array.from({ length: 7 }, (_, i) => [...colors.slice(at + 3 * i, at + 3 * i + 3)] as Rgb);
}

/**
 * Copia del bloque con algunos colores de la paleta del efecto cambiados.
 * Qué lugar se usa lo decide el origen de color de la configuración (ver decodeConfig).
 */
export function withPaletteSlots(colors: Uint8Array, mode: number, slots: Map<number, Rgb>) {
  const out = colors.slice();
  for (const [slot, rgb] of slots) out.set(rgb, PALETTE_BYTES * mode + 3 * slot);
  return out;
}

/** Paleta de fábrica (la misma en todos los efectos). */
export const DEFAULT_PALETTE: Rgb[] = [
  [0xff, 0, 0], [0, 0xff, 0], [0, 0, 0xff], [0xff, 0xff, 0], [0xff, 0, 0xff], [0, 0xff, 0xff], [0xff, 0xff, 0xff],
];

export const rgbToHex = (c: Rgb) => "#" + c.map((x) => hex(x).toLowerCase()).join("");
export const hexToRgb = (s: string): Rgb => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;

/** Payload completo para 0x09: bloque + cola. */
export const colorPayload = (colors: Uint8Array) => {
  const out = new Uint8Array(colors.length + COLOR_TAIL.length);
  out.set(colors);
  out.set(COLOR_TAIL, colors.length);
  return out;
};

/** Largo del último pedazo de una escritura de colores: sin los ceros finales. */
export const trimmedLength = (chunk: Uint8Array) => {
  let n = chunk.length;
  while (n > 0 && chunk[n - 1] === 0) n--;
  return n;
};

export interface Battery {
  percent: number;
  charging: boolean;
}

/**
 * Respuesta de 0x4A: [nivel %][estado]. Confirmado: 63 10 = 99 % con cable, 61 01 = 97 % sin cable.
 * El driver web llama "lleno" al nibble bajo, pero aparece en 1 al estar a batería: no se usa.
 */
export function parseBattery(data: Uint8Array): Battery {
  return { percent: data[0], charging: (data[1] & 0xf0) !== 0 };
}

// ---------- Mapa de teclas (comandos 0x41 / 0x01) ----------

/** Bytes por capa que devuelve la lectura: 4 por tecla, por columnas (offset = keypos − 8). */
export const KEYMAP_LEN = 504;
/** Al escribir se completan 512 bytes con la marca 5A A5 al final, como el driver oficial. */
const KEYMAP_TAIL = [0, 0, 0, 0, 0, 0, 0x5a, 0xa5];

export const LAYERS = [
  { id: 0, name: "Default" },
  { id: 1, name: "Fn" },
  { id: 2, name: "Fn2" },
] as const;

export const keymapPayload = (layer: Uint8Array) => {
  const out = new Uint8Array(KEYMAP_LEN + KEYMAP_TAIL.length);
  out.set(layer.slice(0, KEYMAP_LEN));
  out.set(KEYMAP_TAIL, KEYMAP_LEN);
  return out;
};

/** Offset de una tecla dentro del bloque de una capa. */
export const keyOffset = (key: Key) => key.keypos - 8;

export type Assignment = [number, number, number, number];

export const keyAssignment = (layer: Uint8Array, key: Key) =>
  [...layer.slice(keyOffset(key), keyOffset(key) + 4)] as Assignment;

export function withAssignment(layer: Uint8Array, key: Key, a: Assignment) {
  const out = layer.slice();
  out.set(a, keyOffset(key));
  return out;
}

const MODIFIERS = ["Ctrl", "Shift", "Alt ⌥", "Win ⌘", "Ctrl der.", "Shift der.", "Alt ⌥ der.", "Win ⌘ der."];

/** Multimedia (tipo 02, código de 16 bits en los bytes 2–3). Los de la capa Fn de fábrica. */
const CONSUMER: Record<number, string> = {
  0xe2: "Mute",
  0xe9: "Vol +",
  0xea: "Vol −",
  0xcd: "Play/Pausa",
  0xb5: "Siguiente",
  0xb6: "Anterior",
  0xb7: "Stop",
  0x6f: "Brillo pantalla +",
  0x70: "Brillo pantalla −",
  0x192: "Calculadora",
  0x18a: "Mail",
  0x194: "Mi PC",
  0x223: "Navegador",
  0x22a: "Favoritos",
};

/** Versión corta para dibujar en la tecla. */
const CONSUMER_SHORT: Record<number, string> = {
  0xe2: "Mute",
  0xe9: "Vol+",
  0xea: "Vol−",
  0xcd: "⏯",
  0xb5: "⏭",
  0xb6: "⏮",
  0xb7: "⏹",
  0x6f: "☀+",
  0x70: "☀−",
  0x192: "Calc",
  0x18a: "Mail",
  0x194: "PC",
  0x223: "Web",
  0x22a: "Fav",
};

/**
 * Funciones propias del firmware (tipos 07/08), según el manual del G87 y lo confirmado contra el teclado.
 * Valor → [nombre completo, nombre corto].
 */
export const FIRMWARE: Record<string, [string, string]> = {
  "07 00 00 01": ["Bloquear la tecla Win", "Win lock"],
  "07 00 00 04": ["Restaurar configuración de fábrica (mantener 3 s)", "Reset"],
  "07 00 00 05": ["Dispositivo Bluetooth 1 (mantener para emparejar)", "BT1"],
  "07 00 00 06": ["Dispositivo Bluetooth 2 (mantener para emparejar)", "BT2"],
  "07 00 00 07": ["Dispositivo Bluetooth 3 (mantener para emparejar)", "BT3"],
  "07 00 00 08": ["Emparejar el receptor 2.4G (mantener 3 s)", "2.4G"],
  "07 00 00 0a": ["Función del teclado no documentada en el manual (07 00 00 0A)", "?"],
  "07 00 00 11": ["Mostrar el nivel de batería en las teclas 1–0", "Batería"],
  "07 00 00 18": ["Modo Windows", "Win"],
  "07 00 00 1a": ["Modo Mac (Alt funciona como Command)", "Mac"],
  "08 00 00 00": ["Cambiar el efecto de luz", "Efecto"],
  "08 02 00 00": ["Cambiar el color de la luz", "Color"],
  "08 03 01 00": ["Brillo de la luz +", "Luz+"],
  "08 03 02 00": ["Brillo de la luz −", "Luz−"],
  "08 04 01 00": ["Velocidad de la luz +", "Vel+"],
  "08 04 02 00": ["Velocidad de la luz −", "Vel−"],
};

const EXTRA_KEYS: Record<number, string> = { 0x28: "Enter", 0x2a: "⌫", 0x46: "PrtSc", 0x64: "ISO \\" };
const keyName = (code: number) => EXTRA_KEYS[code] ?? (data.keyNames as Record<string, string>)[code];

/**
 * Nombre legible de una asignación [tipo][mods][código alto][código bajo]:
 * tipo 00 = tecla (+ modificadores), 02 = multimedia, 03 = macro ([03][modo][01][índice]),
 * 0D = Fn, 07/08 = funciones propias del teclado (sistema, iluminación).
 */
export function describeAssignment([type, mods, hi, lo]: Assignment): string {
  if (type === 0 && mods === 0 && lo === 0) return "—";
  if (type === 0) {
    const m = MODIFIERS.filter((_, i) => mods & (1 << i));
    const k = lo ? keyName(lo) ?? `0x${hex(lo)}` : "";
    return [...m, k].filter(Boolean).join(" + ");
  }
  if (type === 2) return CONSUMER[(hi << 8) | lo] ?? `Multimedia 0x${hex((hi << 8) | lo, 4)}`;
  if (type === 0x0d) return "Fn"; // la tecla Fn de fábrica: 0d 00 00 00
  const fw = FIRMWARE[hexBytes([type, mods, hi, lo]).toLowerCase()];
  if (fw) return fw[0];
  if (type === 3 && hi === 1) return `Macro ${lo + 1} · ${MACRO_MODES.find((m) => m.mode === mods)?.short ?? mods}`;
  return `Función del teclado ${hexBytes([type, mods, hi, lo])}`;
}

const MOD_SHORT = ["⌃", "⇧", "⌥", "⌘", "⌃R", "⇧R", "⌥R", "⌘R"];

/** Nombre corto de una asignación, para dibujar en la tecla (el completo va en el tooltip y el panel). */
export function shortAssignment(a: Assignment): string {
  const [type, mods, hi, lo] = a;
  if (type === 0 && mods === 0 && lo === 0) return "—";
  if (type === 0) {
    const m = MOD_SHORT.filter((_, i) => mods & (1 << i)).join("");
    const k = lo ? keyName(lo) ?? hex(lo) : "";
    // Teclas con dos símbolos ("- _", "< ,"): se dejan los dos, como en la tecla física.
    return m + k;
  }
  if (type === 2) return CONSUMER_SHORT[(hi << 8) | lo] ?? "Media";
  if (type === 3 && hi === 1) return `M${lo + 1}`;
  if (type === 0x0d) return "Fn";
  const fw = FIRMWARE[hexBytes(a).toLowerCase()];
  if (fw) return fw[1];
  return `${hex(type)}·${hex(lo || hi || mods)}`;
}

export interface AssignmentOption {
  group: string;
  label: string;
  value: Assignment;
}

/** Asignaciones que se pueden elegir en la interfaz. */
export const ASSIGNMENT_OPTIONS: AssignmentOption[] = [
  ...Object.keys({ ...(data.keyNames as Record<string, string>), ...EXTRA_KEYS })
    .map(Number)
    .sort((a, b) => a - b)
    .map((code) => ({ group: "Teclas", label: keyName(code)!, value: [0, 0, 0, code] as Assignment })),
  ...MODIFIERS.map((label, i) => ({ group: "Modificadores", label, value: [0, 1 << i, 0, 0] as Assignment })),
  ...Object.entries(CONSUMER).map(([code, label]) => ({
    group: "Multimedia",
    label,
    value: [2, 0, +code >> 8, +code & 0xff] as Assignment,
  })),
  // Funciones del firmware (la no documentada queda afuera).
  ...Object.entries(FIRMWARE)
    .filter(([, [, short]]) => short !== "?")
    .map(([bytes, [label]]) => ({
      group: "Funciones",
      label,
      value: bytes.split(" ").map((b) => parseInt(b, 16)) as Assignment,
    })),
  { group: "General", label: "Desactivada", value: [0, 0, 0, 0] },
];

/** KeyboardEvent.code → código HID (página de teclado), para capturar la tecla que la persona aprieta. */
export const HID_BY_CODE: Record<string, number> = {
  ...Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => [`Key${c}`, 0x04 + i])),
  ...Object.fromEntries([..."123456789"].map((d, i) => [`Digit${d}`, 0x1e + i])),
  Digit0: 0x27,
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x3a + i])),
  PrintScreen: 0x46,
  ScrollLock: 0x47,
  Pause: 0x48,
  Insert: 0x49,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  NumLock: 0x53,
  NumpadDivide: 0x54,
  NumpadMultiply: 0x55,
  NumpadSubtract: 0x56,
  NumpadAdd: 0x57,
  NumpadEnter: 0x58,
  ...Object.fromEntries([..."123456789"].map((d, i) => [`Numpad${d}`, 0x59 + i])),
  Numpad0: 0x62,
  NumpadDecimal: 0x63,
  IntlBackslash: 0x64,
  ContextMenu: 0x65,
};

/** Bit de modificador HID por KeyboardEvent.code. */
export const MOD_BY_CODE: Record<string, number> = {
  ControlLeft: 0x01,
  ShiftLeft: 0x02,
  AltLeft: 0x04,
  MetaLeft: 0x08,
  ControlRight: 0x10,
  ShiftRight: 0x20,
  AltRight: 0x40,
  MetaRight: 0x80,
};

/** Modificadores apretados durante un evento, como byte HID (izquierdos). */
export const modsFromEvent = (e: KeyboardEvent) =>
  (e.ctrlKey ? 0x01 : 0) | (e.shiftKey ? 0x02 : 0) | (e.altKey ? 0x04 : 0) | (e.metaKey ? 0x08 : 0);

// ---------- Macros (comandos 0x43 / 0x03) ----------

export const MACRO_PAGE = 512;

/** Modo de reproducción de una macro asignada a una tecla: [03][modo][01][índice]. */
export const MACRO_MODES = [
  { mode: 1, short: "una vez", label: "Ejecutar una vez" },
  { mode: 4, short: "mientras se mantiene", label: "Repetir mientras se mantiene apretada" },
  { mode: 2, short: "hasta re-apretar", label: "Repetir hasta volver a apretar la tecla" },
] as const;

export interface MacroEvent {
  down: boolean;
  /** 0 = tecla, 1 = tecla "extendida" (modificadores y otras > 0x45), 2 = botón de mouse. */
  kind: number;
  code: number;
  /** Demora en ms después del evento (20 bits). */
  delay: number;
}

export interface Macro {
  name: string;
  events: MacroEvent[];
}

/**
 * Memoria de macros: tabla de [dirección LE][largo LE] por macro y, en cada dirección,
 * [largo del nombre][nombre UTF-8][eventos de 4 bytes]. Evento: [flags][demora media][demora baja][código],
 * flags: bit 7 = soltar, bits 4–6 = tipo, bits 0–2 = demora alta.
 */
export function parseMacros(mem: Uint8Array): Macro[] {
  const first = mem[0] | (mem[1] << 8);
  if (!first || first % 4 || first > mem.length) return [];
  const macros: Macro[] = [];
  for (let i = 0; i < first / 4; i++) {
    const addr = mem[4 * i] | (mem[4 * i + 1] << 8);
    const len = mem[4 * i + 2] | (mem[4 * i + 3] << 8);
    if (addr + len > mem.length) break;
    const nameLen = mem[addr];
    const name = new TextDecoder().decode(mem.slice(addr + 1, addr + 1 + nameLen));
    const events: MacroEvent[] = [];
    for (let at = addr + 1 + nameLen; at + 4 <= addr + len; at += 4) {
      const [p, b, g, code] = mem.slice(at, at + 4);
      events.push({ down: !(p & 0x80), kind: (p >> 4) & 7, code, delay: ((p & 7) << 16) | (b << 8) | g });
    }
    macros.push({ name, events });
  }
  return macros;
}

/** Bytes usados de la memoria (hasta el final de la última macro). */
export function macroMemoryEnd(mem: Uint8Array) {
  const first = mem[0] | (mem[1] << 8);
  if (!first || first % 4) return 0;
  let end = first;
  for (let i = 0; i < first / 4; i++) end = Math.max(end, (mem[4 * i] | (mem[4 * i + 1] << 8)) + (mem[4 * i + 2] | (mem[4 * i + 3] << 8)));
  return end;
}

// Igual que el driver oficial: los códigos > 0x45 son "extendidos" salvo navegación y teclado numérico.
const NOT_EXTENDED = [79, 80, 81, 82, 98, 89, 90, 91, 92, 93, 94, 95, 96, 97, 87, 86, 85, 84, 99, 88, 76, 72, 73, 74, 75, 77, 78, 70, 71, 83];
export const macroKeyKind = (code: number) => (code > 69 && !NOT_EXTENDED.includes(code) ? 1 : 0);

/** Arma la memoria completa a partir de la lista de macros (el índice de cada una es su posición). */
export function buildMacros(macros: Macro[]): Uint8Array {
  const bodies = macros.map((m) => {
    const name = new TextEncoder().encode(m.name);
    const events = m.events.flatMap((e) => {
      const d = Math.max(0, Math.min(0x7ffff, e.delay));
      return [(e.down ? 0 : 0x80) | ((e.kind & 7) << 4) | ((d >> 16) & 7), (d >> 8) & 0xff, d & 0xff, e.code];
    });
    return [name.length, ...name, ...events];
  });
  const table: number[] = [];
  let addr = macros.length * 4;
  for (const body of bodies) {
    table.push(addr & 0xff, addr >> 8, body.length & 0xff, body.length >> 8);
    addr += body.length;
  }
  return new Uint8Array([...table, ...bodies.flat()]);
}

/** Texto corto de un evento: "Shift↓", "1↑". */
export function describeMacroEvent(e: MacroEvent) {
  const MOUSE: Record<number, string> = { 1: "Clic izq.", 2: "Clic der.", 4: "Clic medio", 8: "Atrás", 16: "Adelante" };
  const mods: Record<number, string> = { 0xe0: "Ctrl", 0xe1: "Shift", 0xe2: "Alt ⌥", 0xe3: "Win ⌘", 0xe4: "Ctrl der.", 0xe5: "Shift der.", 0xe6: "Alt ⌥ der.", 0xe7: "Win ⌘ der." };
  const name = e.kind === 2 ? MOUSE[e.code] ?? `Mouse ${e.code}` : mods[e.code] ?? keyName(e.code) ?? `0x${hex(e.code)}`;
  return `${name}${e.down ? "↓" : "↑"}`;
}

/** KeyboardEvent.code de modificadores → código HID de tecla (0xE0–0xE7), para grabar macros. */
export const MOD_KEY_BY_CODE: Record<string, number> = {
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
};

/**
 * Ajusta una capa después de borrar la macro `removed`: las teclas que la llamaban quedan sin asignar
 * y las que llamaban a macros posteriores bajan un índice. Devuelve la capa nueva y las teclas tocadas.
 */
export function withMacroRemoved(layer: Uint8Array, removed: number) {
  const out = layer.slice();
  const cleared: Key[] = [];
  const shifted: Key[] = [];
  for (const key of keys) {
    const [type, mode, hi, lo] = keyAssignment(out, key);
    if (type !== 3 || hi !== 1) continue;
    if (lo === removed) {
      out.set([0, 0, 0, 0], keyOffset(key));
      cleared.push(key);
    } else if (lo > removed) {
      out.set([3, mode, 1, lo - 1], keyOffset(key));
      shifted.push(key);
    }
  }
  return { layer: out, cleared, shifted };
}

// ---------- Color por tecla (efecto Self-define; comandos 0x42 / 0x02, por cable 0x86 / 0x06) ----------

/** Tres tablas de 126 bytes (R, G y B); la posición de cada tecla es la misma que en el mapa de teclas. */
export const DIY_SLOTS = 126;
export const DIY_LEN = DIY_SLOTS * 3;
/** Efectos que usan los colores por tecla (el driver oficial los muestra para 19 y 21). */
export const DIY_MODES = [19, 21];

export const diySlot = (key: Key) => (key.keypos - 8) / 4;

export function diyColor(data: Uint8Array, key: Key): Rgb {
  const i = diySlot(key);
  return [data[i], data[DIY_SLOTS + i], data[2 * DIY_SLOTS + i]];
}

/** Copia de las tablas con el color `rgb` en las teclas dadas. */
export function withDiyColor(data: Uint8Array, targets: Key[], rgb: Rgb) {
  const out = data.slice(0, DIY_LEN);
  for (const key of targets) {
    const i = diySlot(key);
    out[i] = rgb[0];
    out[DIY_SLOTS + i] = rgb[1];
    out[2 * DIY_SLOTS + i] = rgb[2];
  }
  return out;
}
