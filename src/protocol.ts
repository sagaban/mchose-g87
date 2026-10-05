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

/** Comandos de lectura confirmados contra el teclado (respuesta multi-paquete). */
export const Cmd = {
  version: 0x05,
  config: 0x44, // = paquete KeyboradConfig (0x84 por cable), 128 bytes
  diyColors: 0x42, // ¿= DiyColorMap (0x86)? sin probar
  baseColors: 0x49, // ¿= BaseColorMap (0x8A)? sin probar
} as const;

/** Aviso asincrónico: [0a][01][00][04][tipo][valor][extra]… */
export type Notice =
  | { kind: "awake"; awake: boolean }
  | { kind: "battery"; percent: number; extra: number }
  | { kind: "lighting" }
  | { kind: "unknown"; raw: Uint8Array };

export function parseNotice(b: Uint8Array): Notice | null {
  if (b[0] !== 0x0a) return null;
  switch (b[4]) {
    case 0x02:
      return { kind: "awake", awake: b[5] === 1 };
    case 0x05: // hipótesis: 0x54 = 84 %
      return { kind: "battery", percent: b[5], extra: b[6] };
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
 *   [0x38 + 2·n + 1]  nibble alto: velocidad (0–4) · nibble bajo: ¿color? (7 = multicolor)
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
    color: cfg[at + 1] & 0x0f,
  };
}
