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
  battery: 0x4a, // [nivel %][cargando<<4 | lleno]
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
export const ConfigOffset = { effect: 10, effectParams: 0x38 } as const;

export function decodeConfig(cfg: Uint8Array) {
  const mode = cfg[ConfigOffset.effect];
  const at = ConfigOffset.effectParams + 2 * mode;
  return {
    effect: effects.find((e) => e.mode === mode) ?? null,
    mode,
    brightness: cfg[at],
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
  const at = ConfigOffset.effectParams + 2 * change.mode;
  if (change.mode === 0) return out; // "Off" no tiene parámetros
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
 * Respuesta de 0x4A: [nivel %][cargando<<4 | ?]. Confirmado: 63 10 = 99 %, cargando.
 * El nibble bajo sería "lleno" según el driver web, pero se vio 54 01 (84 %), así que no se usa.
 */
export function parseBattery(data: Uint8Array): Battery {
  return { percent: data[0], charging: (data[1] & 0xf0) !== 0 };
}
