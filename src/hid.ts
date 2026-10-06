// Capa WebHID: conexión, descripción de interfaces y envío/lectura de reports.
// Lo que sabemos del G87 por su report descriptor (dongle 2.4G, VID 0x41E4 / PID 0x2001):
//   - Usage page 0xFF02, report 0x13: canal vendor de 19 bytes (input + output).
//   - Usage page 0xFF04, report 0x06: feature report de 7 bytes.
// Las colecciones de teclado/mouse están protegidas por el navegador y no aparecen.

export const VENDOR_ID = 0x41e4;

export type ReportKind = "input" | "output" | "feature";

export interface ReportInfo {
  kind: ReportKind;
  id: number;
  /** Bytes de payload, sin contar el report ID. */
  size: number;
}

export interface CollectionInfo {
  usagePage: number;
  usage: number;
  reports: ReportInfo[];
}

export type LogEntry = {
  time: Date;
  dir: "in" | "out" | "feature-get" | "feature-set" | "info" | "error";
  device?: string;
  reportId?: number;
  data?: Uint8Array;
  text?: string;
};

type Listener = (e: LogEntry) => void;

const reportSize = (r: HIDReportInfo) =>
  Math.ceil((r.items ?? []).reduce((n, i) => n + (i.reportSize ?? 0) * (i.reportCount ?? 0), 0) / 8);

export function describe(device: HIDDevice): CollectionInfo[] {
  const flat = (cs: readonly HIDCollectionInfo[]): HIDCollectionInfo[] =>
    cs.flatMap((c) => [c, ...flat(c.children ?? [])]);
  return flat(device.collections).map((c) => ({
    usagePage: c.usagePage ?? 0,
    usage: c.usage ?? 0,
    reports: [
      ...(c.inputReports ?? []).map((r) => ({ kind: "input" as const, id: r.reportId ?? 0, size: reportSize(r) })),
      ...(c.outputReports ?? []).map((r) => ({ kind: "output" as const, id: r.reportId ?? 0, size: reportSize(r) })),
      ...(c.featureReports ?? []).map((r) => ({ kind: "feature" as const, id: r.reportId ?? 0, size: reportSize(r) })),
    ],
  }));
}

export const deviceLabel = (d: HIDDevice) => {
  const pages = describe(d)
    .map((c) => `0x${c.usagePage.toString(16).toUpperCase()}`)
    .filter((p, i, a) => a.indexOf(p) === i);
  return `${d.productName} [${pages.join(", ")}]`;
};

export class DisconnectedError extends Error {
  constructor(message = "El teclado se desconectó a mitad de la operación.") {
    super(message);
  }
}

export class Hid {
  devices: HIDDevice[] = [];
  /** Se perdió la conexión sin que el usuario desconectara: hay que volver a autorizar. */
  lost = false;
  private listeners = new Set<Listener>();
  /** Operaciones en curso: se cortan si el teclado se desconecta. */
  private pending = new Set<(e: Error) => void>();
  /**
   * Cola de operaciones con el canal vendor: una a la vez. Dos pedidos del mismo comando en vuelo
   * (por ejemplo, dos capas del mapa de teclas) mezclarían sus respuestas.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  get supported() {
    return "hid" in navigator;
  }

  onLog(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private log(e: Omit<LogEntry, "time">) {
    const entry = { ...e, time: new Date() };
    this.listeners.forEach((fn) => fn(entry));
  }

  /**
   * Sigue conexiones y desconexiones. El dongle no informa número de serie, así que si se
   * reinicia Chrome lo ve como un dispositivo nuevo y pierde el permiso: no llega "connect"
   * y hay que volver a autorizarlo con requestDevice(). Si el permiso sigue, se reabre solo.
   */
  watch(onChange: () => void) {
    navigator.hid.addEventListener("disconnect", (e) => {
      if (!this.devices.includes(e.device)) return;
      this.devices = this.devices.filter((d) => d !== e.device);
      if (this.devices.length) return;
      this.lost = true;
      this.log({ dir: "info", text: "El teclado se desconectó" });
      const err = new DisconnectedError();
      this.pending.forEach((abort) => abort(err));
      this.pending.clear();
      onChange();
    });
    navigator.hid.addEventListener("connect", async (e) => {
      if (e.device.vendorId !== VENDOR_ID) return;
      try {
        await this.open([e.device]);
        this.log({ dir: "info", text: "Reconectado automáticamente" });
      } catch (err) {
        this.log({ dir: "error", text: err instanceof Error ? err.message : String(err) });
      }
      onChange();
    });
  }

  /** Interfaz con el canal vendor 0x13 (modo dongle), o un error que explique por qué no está. */
  private vendorDevice() {
    if (!this.devices.length) throw new DisconnectedError("El teclado no está conectado.");
    const d = this.find("output", VENDOR_REPORT);
    if (!d) throw new Error("Este modo de conexión no tiene el canal 0x13 (¿está conectado por cable?)");
    return d;
  }

  /** Corta `p` con DisconnectedError si el teclado se desconecta antes de que termine. */
  private guard<T>(p: Promise<T>): Promise<T> {
    let abort!: (e: Error) => void;
    const lost = new Promise<never>((_, reject) => (abort = reject));
    this.pending.add(abort);
    return Promise.race([p, lost]).finally(() => this.pending.delete(abort));
  }

  /** Dispositivos ya autorizados en sesiones anteriores, sin pedir permiso. */
  async restore() {
    const granted = await navigator.hid.getDevices();
    await this.open(granted.filter((d) => d.vendorId === VENDOR_ID));
  }

  async request() {
    const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID }] });
    // Chrome devuelve un HIDDevice por interfaz; pedimos permiso para todas las del mismo producto.
    const all = await navigator.hid.getDevices();
    const ids = new Set(picked.map((d) => d.productId));
    await this.open(all.filter((d) => d.vendorId === VENDOR_ID && ids.has(d.productId)));
  }

  private async open(devices: HIDDevice[]) {
    for (const d of devices) {
      if (this.devices.includes(d)) continue;
      if (!d.opened) {
        try {
          await d.open();
        } catch {
          // En macOS solo una pestaña/app puede tener abierta la interfaz a la vez.
          throw new Error("No se pudo abrir el teclado. ¿Está abierto en otra pestaña o en otra app?");
        }
      }
      d.addEventListener("inputreport", (e) => {
        const ev = e as HIDInputReportEvent;
        this.log({
          dir: "in",
          device: deviceLabel(d),
          reportId: ev.reportId,
          data: new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength),
        });
      });
      this.devices.push(d);
      this.lost = false;
      this.log({ dir: "info", text: `Abierto: ${deviceLabel(d)} (PID 0x${d.productId.toString(16)})` });
    }
  }

  async close() {
    for (const d of this.devices) await d.close();
    this.devices = [];
    this.lost = false;
    this.log({ dir: "info", text: "Desconectado" });
  }

  /** Primer dispositivo abierto que declara ese report. */
  find(kind: ReportKind, id: number) {
    return this.devices.find((d) => describe(d).some((c) => c.reports.some((r) => r.kind === kind && r.id === id)));
  }

  /** GET_REPORT de un feature report. No modifica el teclado. */
  async readFeature(id: number) {
    const d = this.find("feature", id);
    if (!d) throw new Error(`Ninguna interfaz declara el feature report 0x${id.toString(16)}`);
    const view = await d.receiveFeatureReport(id);
    const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    this.log({ dir: "feature-get", device: deviceLabel(d), reportId: id, data });
    return data;
  }

  async sendOutput(id: number, data: Uint8Array) {
    const d = this.find("output", id);
    if (!d) throw new Error(`Ninguna interfaz declara el output report 0x${id.toString(16)}`);
    await d.sendReport(id, data as Uint8Array<ArrayBuffer>);
    this.log({ dir: "out", device: deviceLabel(d), reportId: id, data });
  }

  async sendFeature(id: number, data: Uint8Array) {
    const d = this.find("feature", id);
    if (!d) throw new Error(`Ninguna interfaz declara el feature report 0x${id.toString(16)}`);
    await d.sendFeatureReport(id, data as Uint8Array<ArrayBuffer>);
    this.log({ dir: "feature-set", device: deviceLabel(d), reportId: id, data });
  }

  /**
   * Pedido por el canal vendor 0x13 (modo dongle) y respuesta multi-paquete:
   * cada respuesta es [cmd][total][seq][len][datos…][checksum]. Si el teclado está dormido,
   * el dongle guarda el pedido y lo entrega al despertar; `onSlow` avisa para pedir una tecla.
   */
  query(
    cmd: number,
    sub = 0x01,
    // Hasta 60 s: si el teclado duerme, hay que darle tiempo a la persona para apretar una tecla.
    // `accept` filtra respuestas (por ejemplo, solo las de una capa).
    opts: { timeoutMs?: number; onSlow?: () => void; args?: number[]; accept?: (b: Uint8Array) => boolean } = {},
  ): Promise<Uint8Array> {
    return this.exclusive(() => this.queryNow(cmd, sub, opts));
  }

  private async queryNow(
    cmd: number,
    sub: number,
    { timeoutMs = 60000, onSlow = () => {}, args = [] as number[], accept = (_: Uint8Array) => true },
  ): Promise<Uint8Array> {
    const d = this.vendorDevice();

    const parts = new Map<number, Uint8Array>();
    let total = -1;
    let onReport!: (e: Event) => void;
    const done = new Promise<Uint8Array>((resolve, reject) => {
      const slow = setTimeout(onSlow, 1500);
      const timer = setTimeout(() => {
        clearTimeout(slow);
        reject(new Error(`Sin respuesta al comando 0x${cmd.toString(16)}. Apretá una tecla del teclado y reintentá.`));
      }, timeoutMs);
      onReport = (e) => {
        const ev = e as HIDInputReportEvent;
        const b = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
        if (ev.reportId !== VENDOR_REPORT || b[0] !== cmd || !validChecksum(b) || !accept(b)) return;
        total = b[1];
        // El nibble alto del largo puede traer la capa (mapa de teclas): el largo máximo es 14.
        parts.set(b[2], b.slice(4, 4 + (b[3] & 0x0f)));
        if (parts.size === total) {
          clearTimeout(timer);
          clearTimeout(slow);
          const chunks = [...parts.entries()].sort((a, z) => a[0] - z[0]).map(([, c]) => c);
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          chunks.reduce((off, c) => (out.set(c, off), off + c.length), 0);
          resolve(out);
        }
      };
    });

    // Al despertar, el dongle a veces pierde partes de la respuesta: se reenvía el pedido
    // cada 2,5 s y se acumulan las partes de todos los intentos (los datos son los mismos).
    const send = () => this.sendOutput(VENDOR_REPORT, buildVendorPacket(cmd, sub, args));
    const retry = setInterval(() => send().catch(() => {}), 2500);
    d.addEventListener("inputreport", onReport);
    try {
      await send();
      return await this.guard(done);
    } finally {
      clearInterval(retry);
      d.removeEventListener("inputreport", onReport);
    }
  }

  /**
   * Escritura por el canal vendor 0x13: el bloque va en pedazos de 14 bytes
   * [cmd][total][idx][len][datos…] y el teclado confirma cada uno devolviendo cmd + idx.
   * Sin confirmación se reintenta el pedazo; si falla 3 veces se aborta.
   */
  writeBlock(cmd: number, payload: Uint8Array, opts: { lastLen?: (c: Uint8Array) => number; lenTag?: number } = {}) {
    return this.exclusive(() => this.writeBlockNow(cmd, payload, opts));
  }

  private async writeBlockNow(
    cmd: number,
    payload: Uint8Array,
    { lastLen = (c: Uint8Array) => c.length, lenTag = 0 },
  ) {
    const d = this.vendorDevice();

    const chunks: Uint8Array[] = [];
    for (let i = 0; i < payload.length; i += CHUNK) chunks.push(payload.slice(i, i + CHUNK));

    for (const [idx, chunk] of chunks.entries()) {
      const len = idx === chunks.length - 1 ? lastLen(chunk) : CHUNK;
      // lenTag va en el nibble alto del largo: la capa (mapa de teclas) o la página (macros).
      const packet = buildVendorPacket(cmd, chunks.length, [idx, lenTag | len, ...chunk]);
      let acked = false;
      for (let attempt = 0; attempt < 3 && !acked; attempt++) {
        const ack = this.waitFor(d, (b) => b[0] === cmd && b[2] === idx, 500);
        await this.sendOutput(VENDOR_REPORT, packet);
        try {
          acked = await this.guard(ack);
        } catch (e) {
          if (e instanceof DisconnectedError && idx > 0)
            throw new DisconnectedError(
              `El teclado se desconectó en el pedazo ${idx + 1}/${chunks.length}: la escritura quedó incompleta. Volvé a conectar y aplicá de nuevo.`,
            );
          throw e;
        }
      }
      if (!acked) throw new Error(`El teclado no confirmó el pedazo ${idx + 1}/${chunks.length} del comando 0x${cmd.toString(16)}`);
    }
  }

  /** Interfaz con el feature report de 519 bytes: el teclado está conectado por cable. */
  wiredDevice() {
    return this.devices.find((d) =>
      describe(d).some((c) => c.reports.some((r) => r.kind === "feature" && r.id === WIRED_REPORT && r.size >= WIRED_SIZE)),
    );
  }

  /**
   * Lectura por cable: SET_FEATURE con [comando de lectura][encabezado] y GET_FEATURE de la respuesta,
   * que repite comando y encabezado antes de los datos. El largo de los datos va en el encabezado (bytes 4–5).
   */
  wiredRead(cmd: number, header: number[]): Promise<Uint8Array> {
    return this.exclusive(async () => {
      const d = this.wiredDevice();
      if (!d) throw new DisconnectedError("El teclado no está conectado por cable.");
      const req = new Uint8Array(WIRED_SIZE);
      req.set([cmd, ...header]);
      await d.sendFeatureReport(WIRED_REPORT, req);
      this.log({ dir: "feature-set", device: deviceLabel(d), reportId: WIRED_REPORT, data: req.slice(0, 7) });
      const view = await d.receiveFeatureReport(WIRED_REPORT);
      const res = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      this.log({ dir: "feature-get", device: deviceLabel(d), reportId: WIRED_REPORT, data: res.slice(0, 24) });
      // En macOS Chrome incluye el report ID al principio de la respuesta; en otros sistemas no.
      const off = res[0] === WIRED_REPORT && res[1] === cmd ? 1 : 0;
      if (res[off] !== cmd) throw new Error(`Respuesta inesperada al comando 0x${cmd.toString(16)} por cable.`);
      const len = header[4] | (header[5] << 8);
      return res.slice(off + 7, off + 7 + len);
    });
  }

  /** Escritura por cable: [comando][encabezado][datos] en un solo feature report. */
  wiredWrite(cmd: number, header: number[], data: Uint8Array): Promise<void> {
    return this.exclusive(async () => {
      const d = this.wiredDevice();
      if (!d) throw new DisconnectedError("El teclado no está conectado por cable.");
      if (7 + data.length > WIRED_SIZE) throw new Error(`Bloque demasiado grande para un paquete: ${data.length} bytes.`);
      const req = new Uint8Array(WIRED_SIZE);
      req.set([cmd, ...header]);
      req.set(data, 7);
      await d.sendFeatureReport(WIRED_REPORT, req);
      this.log({ dir: "feature-set", device: deviceLabel(d), reportId: WIRED_REPORT, data: req.slice(0, 24) });
    });
  }

  /** Espera un input report 0x13 válido que cumpla `match`. Resuelve false al vencer el plazo. */
  private waitFor(d: HIDDevice, match: (b: Uint8Array) => boolean, ms: number) {
    return new Promise<boolean>((resolve) => {
      const onReport = (e: Event) => {
        const ev = e as HIDInputReportEvent;
        const b = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
        if (ev.reportId === VENDOR_REPORT && validChecksum(b) && match(b)) finish(true);
      };
      const timer = setTimeout(() => finish(false), ms);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        d.removeEventListener("inputreport", onReport);
        resolve(ok);
      };
      d.addEventListener("inputreport", onReport);
    });
  }
}

/** Bytes de datos por paquete en el canal vendor. */
const CHUNK = 14;

export const VENDOR_REPORT = 0x13;
/** Por cable: feature report 0x06 de 519 bytes ([comando][encabezado de 6][datos]). */
export const WIRED_REPORT = 0x06;
const WIRED_SIZE = 519;

/** 19 bytes de payload (sin report ID). El último es la suma de report ID + bytes 0..17. */
export function buildVendorPacket(cmd: number, sub: number, data: ArrayLike<number> = []) {
  const buf = new Uint8Array(19);
  buf[0] = cmd;
  buf[1] = sub;
  buf.set(Array.from(data).slice(0, 16), 2);
  buf[18] = buf.slice(0, 18).reduce((s, x) => s + x, VENDOR_REPORT) & 0xff;
  return buf;
}

export const validChecksum = (b: Uint8Array) =>
  b.length >= 19 && (b.slice(0, 18).reduce((s, x) => s + x, VENDOR_REPORT) & 0xff) === b[18];
