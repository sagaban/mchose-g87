// Operaciones con el teclado independientes de la conexión: el receptor 2.4G (report 0x13 en pedazos de
// 14 bytes) o el cable (feature report 0x06 de 519 bytes). Los datos tienen el mismo formato en los dos.
import { VENDOR_REPORT, type Hid } from "./hid";
import {
  Cmd,
  COLOR_LEN,
  colorPayload,
  KEYMAP_LEN,
  keymapPayload,
  MACRO_PAGE,
  macroMemoryEnd,
  trimmedLength,
} from "./protocol";

/** Opciones de espera para el receptor (el teclado puede estar dormido). Por cable no aplican. */
export interface WaitOptions {
  timeoutMs?: number;
  onSlow?: () => void;
}

/**
 * Por cable, cada bloque se lee con [comando | 0x80][encabezado] y se escribe con [comando][mismo encabezado][datos].
 * Encabezado: [arg bajo][arg alto][01][00][largo bajo][largo alto]; en las macros, [00][00][páginas][página][largo].
 */
const WIRED = {
  config: { read: 0x84, write: 0x04, header: [0x00, 0x00, 0x01, 0x00, 0x80, 0x00] },
  colors: { read: 0x8a, write: 0x0a, header: [0x00, 0x00, 0x01, 0x00, 0x00, 0x02] },
  keymap: { read: 0x83, write: 0x03, header: (layer: number) => [layer, 0x00, 0x01, 0x00, 0xf8, 0x01] },
  macros: { read: 0x85, write: 0x05 },
  battery: { read: 0x87, header: [0x00, 0x00, 0x01, 0x00, 0x02, 0x00] },
  version: { read: 0x82, header: [0x01, 0x00, 0x01, 0x00, 0x06, 0x00] },
};

export function createDevice(hid: Hid) {
  const wired = () => !!hid.wiredDevice();

  const api = {
    /** Hay un canal de configuración (receptor o cable). */
    available: () => wired() || !!hid.find("output", VENDOR_REPORT),
    wired,

    readConfig: (w: WaitOptions = {}) =>
      wired() ? hid.wiredRead(WIRED.config.read, WIRED.config.header) : hid.query(Cmd.config, 0x01, w),

    writeConfig: (data: Uint8Array) =>
      wired() ? hid.wiredWrite(WIRED.config.write, WIRED.config.header, data) : hid.writeBlock(Cmd.setConfig, data),

    readColors: async (w: WaitOptions = {}) =>
      (wired() ? await hid.wiredRead(WIRED.colors.read, WIRED.colors.header) : await hid.query(Cmd.colors, 0x01, w)).slice(0, COLOR_LEN),

    /** Los 490 bytes de paletas; la cola con 5A A5 se agrega acá (por cable entran 512 bytes en el paquete). */
    writeColors: (data: Uint8Array) =>
      wired()
        ? hid.wiredWrite(WIRED.colors.write, WIRED.colors.header, colorPayload(data).slice(0, 512))
        : hid.writeBlock(Cmd.setColors, colorPayload(data), { lastLen: trimmedLength }),

    readLayer: (layer: number, w: WaitOptions = {}) =>
      wired()
        ? hid.wiredRead(WIRED.keymap.read, WIRED.keymap.header(layer))
        : // La respuesta trae la capa en el nibble alto del largo: solo se aceptan pedazos de esta capa.
          hid.query(Cmd.keymap, 0x01, { ...w, args: [0x00, layer << 4], accept: (b) => b[3] >> 4 === layer }),

    /** Los 504 bytes de la capa; se completan a 512 con la marca 5A A5 como el driver oficial. */
    writeLayer: (layer: number, data: Uint8Array) =>
      wired()
        ? hid.wiredWrite(WIRED.keymap.write, WIRED.keymap.header(layer), keymapPayload(data.slice(0, KEYMAP_LEN)))
        : hid.writeBlock(Cmd.setKeymap, keymapPayload(data.slice(0, KEYMAP_LEN)), { lenTag: layer << 4, lastLen: trimmedLength }),

    readMacroPage: (page: number, w: WaitOptions = {}) =>
      wired()
        ? hid.wiredRead(WIRED.macros.read, [0x00, 0x00, 0x01, page, 0x00, 0x02])
        : hid.query(Cmd.macros, 0x01, { ...w, args: [0x00, page << 4] }),

    /** Lee las páginas necesarias de la memoria de macros (la tabla dice hasta dónde hay datos). */
    readMacroMemory: async (w: WaitOptions = {}) => {
      let mem = await api.readMacroPage(0, w);
      const end = macroMemoryEnd(mem);
      for (let n = 1; n * MACRO_PAGE < end; n++) mem = new Uint8Array([...mem, ...(await api.readMacroPage(n, w))]);
      return mem.slice(0, end);
    },

    /**
     * Escribe la memoria de macros por páginas de 512 bytes. Por el receptor cada página es una tanda con índice
     * desde 0 (con índices continuos el teclado descarta la página 1); por cable, un paquete por página.
     */
    writeMacroMemory: async (mem: Uint8Array, onPage: (page: number) => void = () => {}) => {
      const pages = Math.ceil(mem.length / MACRO_PAGE);
      for (let page = 0; page < pages; page++) {
        onPage(page);
        const chunk = mem.slice(page * MACRO_PAGE, (page + 1) * MACRO_PAGE);
        if (wired()) {
          const header = [0x00, 0x00, pages, page, chunk.length & 0xff, chunk.length >> 8];
          await hid.wiredWrite(WIRED.macros.write, header, chunk);
        } else await hid.writeBlock(Cmd.setMacros, chunk, { lenTag: page << 4 });
      }
    },

    readBattery: (w: WaitOptions = {}) =>
      wired() ? hid.wiredRead(WIRED.battery.read, WIRED.battery.header) : hid.query(Cmd.battery, 0x01, w),

    readVersion: (w: WaitOptions = {}) =>
      wired() ? hid.wiredRead(WIRED.version.read, WIRED.version.header) : hid.query(Cmd.version, 0x01, w),
  };
  return api;
}
