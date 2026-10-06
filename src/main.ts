import { Hid, VENDOR_REPORT, describe, deviceLabel, type LogEntry } from "./hid";
import {
  Cmd,
  configDiff,
  decodeConfig,
  ConfigOffset,
  LEVEL_MAX,
  AUTO_COLOR,
  withLight,
  COLOR_LEN,
  colorPayload,
  hexToRgb,
  palette,
  rgbToHex,
  trimmedLength,
  withPaletteSlots,
  ASSIGNMENT_OPTIONS,
  LAYERS,
  describeAssignment,
  keyAssignment,
  keymapPayload,
  withAssignment,
  parseMacros,
  buildMacros,
  macroMemoryEnd,
  describeMacroEvent,
  macroKeyKind,
  MACRO_PAGE,
  MACRO_MODES,
  MOD_KEY_BY_CODE,
  type Macro,
  type MacroEvent,
  HID_BY_CODE,
  MOD_BY_CODE,
  modsFromEvent,
  type Assignment,
  type AssignmentOption,
  DEFAULT_PALETTE,
  type Rgb,
  parseNotice,
  parseBattery,
  type Battery,
  effects,
  hex,
  hexBytes,
  keys,
  packetNames,
  packets,
  parseHeader,
  parseHexInput,
  type Effect,
  type Key,
} from "./protocol";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

const hid = new Hid();

// ---------- Tabs ----------

document.querySelectorAll<HTMLButtonElement>("nav button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button, .tab").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
  }),
);

// ---------- Conexión ----------

function renderConnection() {
  const on = hid.devices.length > 0;
  $("#status").textContent = on ? `Conectado (${hid.devices[0].productName})` : "Desconectado";
  $("#status").className = `status ${on ? "on" : "off"}`;
  $("#connect").hidden = on || hid.lost;
  $("#reconnect").hidden = on || !hid.lost;
  $("#disconnect").hidden = !on;
  $("#kb-state").hidden = !hid.find("output", VENDOR_REPORT);
  if (!on) $("#battery").hidden = true;
  renderEffects();

  $("#device-info").innerHTML = hid.devices
    .map((d) => {
      const rows = describe(d)
        .flatMap((c) =>
          c.reports.map(
            (r) => `<tr>
              <td class="mono">0x${hex(c.usagePage, 4)} / 0x${hex(c.usage)}</td>
              <td>${r.kind}</td>
              <td class="mono">0x${hex(r.id)}</td>
              <td>${r.size} bytes</td>
            </tr>`,
          ),
        )
        .join("");
      return `<div class="panel">
        <h3>${esc(deviceLabel(d))}</h3>
        <p class="hint mono">VID 0x${hex(d.vendorId, 4)} · PID 0x${hex(d.productId, 4)}</p>
        <table>
          <thead><tr><th>Usage page / usage</th><th>Tipo</th><th>Report ID</th><th>Tamaño</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="hint">Sin reports accesibles (colección protegida)</td></tr>`}</tbody>
        </table>
      </div>`;
    })
    .join("");
}

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    appendLog({ time: new Date(), dir: "error", text: e instanceof Error ? e.message : String(e) });
  }
  // Acceso desde la consola del navegador para depurar el protocolo.
if (import.meta.env.DEV) Object.assign(window, { g87: { hid, Cmd, withLight, decodeConfig, withPaletteSlots, colorPayload, trimmedLength, palette, parseMacros, buildMacros, macroMemoryEnd, describeMacroEvent } });

renderConnection();
}

const connect = () => run(() => hid.request()).then(() => refreshBattery());
$("#connect").addEventListener("click", connect);
$("#reconnect-btn").addEventListener("click", connect);
$("#disconnect").addEventListener("click", () => run(() => hid.close()));

if (hid.supported) {
  hid.watch(() => {
    renderConnection();
    if (hid.devices.length) refreshBattery();
  });
  run(() => hid.restore()).then(() => refreshBattery());
} else {
  $("#unsupported").hidden = false;
  $<HTMLButtonElement>("#connect").disabled = true;
}

// ---------- Estado (canal vendor 0x13) ----------

hid.onLog((e) => {
  if (e.dir !== "in" || e.reportId !== VENDOR_REPORT || !e.data) return;
  const n = parseNotice(e.data);
  // Cualquier respuesta (no aviso) prueba que está despierto.
  if (!n) setAwake(true);
  if (n?.kind === "awake") setAwake(n.awake);
  if (n?.kind === "battery") showBattery(n.battery);
  // Al despertar se consulta: el aviso de batería llega solo cada tanto.
  if (n?.kind === "awake" && n.awake) refreshBattery();
});

const waking = {
  onSlow: () => ($("#st-awake").textContent = "Esperando respuesta… apretá una tecla para despertarlo"),
};

function setAwake(awake: boolean) {
  $("#st-awake").textContent = awake ? "Despierto" : "Dormido: apretá una tecla para despertarlo";
}

let batteryPending = false;

/** Consulta 0x4A y actualiza la batería. Silenciosa: si el teclado duerme, se reintenta al despertar. */
async function refreshBattery({ timeoutMs = 5000 } = {}) {
  if (batteryPending || !hid.find("output", VENDOR_REPORT)) return;
  batteryPending = true;
  try {
    showBattery(parseBattery(await hid.query(Cmd.battery, 0x01, { timeoutMs })));
  } catch {
    // Sin respuesta: dormido. El aviso de "despierto" dispara otra consulta.
    if (hid.devices.length) {
      setAwake(false);
      if (!$("#battery").textContent) $("#st-battery").textContent = "Se actualiza cuando despierte";
    }
  } finally {
    batteryPending = false;
  }
}

function showBattery(b: Battery) {
  const state = b.charging ? " · cargando" : "";
  $("#st-battery").textContent = `${b.percent} %${state}`;
  $("#battery").textContent = `${b.charging ? "⚡" : "🔋"} ${b.percent} %`;
  $("#battery").classList.toggle("low", b.percent <= 15 && !b.charging);
  $("#battery").hidden = false;
}

$("#read-battery").addEventListener("click", () =>
  run(async () => showBattery(parseBattery(await hid.query(Cmd.battery, 0x01, waking)))),
);

$("#read-version").addEventListener("click", () =>
  run(async () => {
    const v = await hid.query(Cmd.version, 0x01, waking);
    $("#st-version").textContent = hexBytes(v);
  }),
);

$("#read-config").addEventListener("click", () =>
  run(async () => {
    const cfg = await hid.query(Cmd.config, 0x01, waking);
    lastConfig = cfg;
    lastColors = (await hid.query(Cmd.colors, 0x01, waking)).slice(0, COLOR_LEN);
    renderEffects();
    const diff = configDiff(cfg);
    const changed = new Set(diff.map((d) => d.offset));
    const lines = [];
    for (let i = 0; i < cfg.length; i += 16) {
      const cells = [...cfg.slice(i, i + 16)].map((b, j) =>
        changed.has(i + j) ? `<mark>${hex(b)}</mark>` : hex(b),
      );
      lines.push(`${hex(i, 4)}  ${cells.join(" ")}`);
    }
    const c = decodeConfig(cfg);
    $("#config-out").innerHTML = `
      <dl>
        <dt>Efecto</dt><dd>${esc(c.effect?.name ?? "desconocido")} <span class="hint mono">(modo ${c.mode})</span></dd>
        <dt>Brillo</dt><dd>${c.brightness} / 4</dd>
        <dt>Velocidad</dt><dd>${c.speed} / 4</dd>
        <dt>Color</dt><dd>${c.colorSource === AUTO_COLOR ? "Automático (todo el espectro)" : `Lugar ${c.colorSource + 1} de la paleta`}</dd>
      </dl>
      <p class="hint">${cfg.length} bytes. Resaltado: distinto del valor de fábrica (${diff.length} bytes).</p>
      <pre class="hexdump">${lines.join("\n")}</pre>
      <table><thead><tr><th>Offset</th><th>Fábrica</th><th>Actual</th></tr></thead><tbody>
        ${diff.map((d) => `<tr class="mono"><td>${d.offset} (0x${hex(d.offset)})</td><td>${hex(d.factory)}</td><td>${hex(d.current)}</td></tr>`).join("")}
      </tbody></table>`;
  }),
);

// ---------- Teclado ----------

let currentLayer = 0;
/** Capas leídas del teclado (504 bytes cada una). */
const layers = new Map<number, Uint8Array>();
let selectedKey: Key | null = null;

/** Asignación de fábrica: capa Default = KeyValue del XML, capa Fn = paquete Fn_default del INI. */
function factoryAssignment(key: Key, layer: number): Assignment {
  if (layer === 0) return [key.code >>> 24, (key.code >> 16) & 0xff, (key.code >> 8) & 0xff, key.code & 0xff];
  if (layer === 1) return [...packets["Fn_default.KeyCode"].slice(key.keypos, key.keypos + 4)] as Assignment;
  return [0, 0, 0, 0];
}

const sameAssignment = (a: Assignment, b: Assignment) => a.every((x, i) => x === b[i]);

$("#layers").innerHTML = LAYERS.map(
  (l) => `<label><input type="radio" name="layer" value="${l.id}" ${l.id === 0 ? "checked" : ""} /> ${l.name}</label>`,
).join("");
$("#layers").querySelectorAll<HTMLInputElement>("input").forEach((el) =>
  el.addEventListener("change", () => {
    currentLayer = Number(el.value);
    renderBoard();
    renderMacros(); // muestra qué tecla usa cada macro
    if (selectedKey) renderKey(selectedKey);
  }),
);

const board = $("#board");
const keyEls = new Map<Key, HTMLButtonElement>();
for (const key of keys.filter((k) => !k.hidden)) {
  const el = document.createElement("button");
  el.className = "key";
  // Coordenadas del XML (lienzo de ~640×290) a porcentajes del contenedor.
  Object.assign(el.style, {
    left: `${(key.x / 640) * 100}%`,
    top: `${(key.y / 290) * 100}%`,
    width: `${(key.w / 640) * 100}%`,
    height: `${(key.h / 290) * 100}%`,
  });
  el.addEventListener("click", () => {
    selectedKey = key;
    board.querySelectorAll(".selected").forEach((s) => s.classList.remove("selected"));
    el.classList.add("selected");
    renderKey(key);
  });
  keyEls.set(key, el);
  board.append(el);
}

/** Muestra en cada tecla lo que hace en la capa elegida; resalta lo que difiere de fábrica. */
function renderBoard() {
  const layer = layers.get(currentLayer);
  for (const [key, el] of keyEls) {
    if (!layer) {
      el.textContent = key.label;
      el.title = key.id;
      el.classList.remove("remapped", "unassigned");
      continue;
    }
    const a = keyAssignment(layer, key);
    const text = describeAssignment(a);
    // En Fn/Fn2 una tecla sin asignar no hace nada: se muestra su nombre atenuado para ubicarla.
    const empty = currentLayer !== 0 && text === "—";
    el.textContent = empty ? key.label : text;
    el.classList.toggle("unassigned", empty);
    el.title = `${key.label}: ${empty ? "sin asignar en esta capa" : text}`;
    el.classList.toggle("remapped", !sameAssignment(a, factoryAssignment(key, currentLayer)));
  }
  $("#layer-status").textContent = layer
    ? currentLayer === 0
      ? "Resaltadas: distintas de fábrica."
      : "Resaltadas: distintas de fábrica. Punteadas: sin asignar en esta capa (se pueden asignar)."
    : `Capa ${LAYERS[currentLayer].name} sin leer.`;
}

$("#read-layer").addEventListener("click", () =>
  run(async () => {
    $("#layer-status").textContent = "Leyendo…";
    try {
      layers.set(currentLayer, await hid.query(Cmd.keymap, 0x01, { ...waking, args: [0x00, currentLayer << 4] }));
    } catch (e) {
      $("#layer-status").textContent = "No se pudo leer: ver la consola HID";
      throw e;
    }
    renderBoard();
    if (selectedKey) renderKey(selectedKey);
  }),
);

/** Modo de reproducción elegido para asignar macros. */
let macroMode: number = MACRO_MODES[0].mode;

/** Opciones fijas más una por macro leída (con el modo elegido). */
const allOptions = (): AssignmentOption[] => [
  ...ASSIGNMENT_OPTIONS,
  ...(lastMacros ?? []).map((m, i) => ({
    group: "Macros",
    label: `${i + 1}. ${m.name || "(sin nombre)"}`,
    value: [3, macroMode, 1, i] as Assignment,
  })),
];
// "Macros" va siempre: si todavía no se leyeron, la pestaña ofrece leerlas.
const pickerGroups = () => [...new Set([...ASSIGNMENT_OPTIONS.map((o) => o.group), "Macros"])];
/** Pestaña del selector elegida (se recuerda entre teclas). */
let pickerGroup = "Teclas";
/** Asignación elegida en el panel, todavía sin aplicar. */
let pending: Assignment | null = null;
let stopCapture: (() => void) | null = null;

function renderKey(key: Key) {
  stopCapture?.();
  const layer = layers.get(currentLayer);
  const detail = $("#key-detail");
  detail.className = "panel";
  if (!layer) {
    detail.innerHTML = `<h3>${esc(key.label)}</h3><p class="hint">Leé la capa ${LAYERS[currentLayer].name} para ver y cambiar esta tecla.</p>`;
    return;
  }
  const current = keyAssignment(layer, key);
  const factory = factoryAssignment(key, currentLayer);
  pending = null;
  detail.innerHTML = `
    <h3>${esc(key.label)} <span class="hint">· capa ${LAYERS[currentLayer].name}</span></h3>
    <dl>
      <dt>Ahora</dt><dd>${esc(describeAssignment(current))} <span class="hint mono">${hexBytes(current)}</span></dd>
      <dt>De fábrica</dt><dd>${esc(describeAssignment(factory))} <span class="hint mono">${hexBytes(factory)}</span></dd>
    </dl>
    <div class="picker">
      <div class="picker-bar">
        <button id="key-capture">⌨ Presioná una tecla…</button>
        <input id="key-search" type="search" placeholder="Buscar (F5, vol, shift…)" />
      </div>
      <div class="picker-tabs">${pickerGroups()
        .map((g) => `<button data-group="${g}" class="${g === pickerGroup ? "active" : ""}">${g}</button>`)
        .join("")}</div>
      <p id="macro-mode-row" class="assign" hidden>
        <label>Modo
          <select id="macro-mode">${MACRO_MODES.map(
            (m) => `<option value="${m.mode}" ${m.mode === macroMode ? "selected" : ""}>${m.label}</option>`,
          ).join("")}</select>
        </label>
      </p>
      <div id="picker-grid" class="picker-grid"></div>
    </div>
    <p class="assign">
      <span>Nueva: <b id="key-choice">—</b></span>
      <button id="key-factory" ${sameAssignment(current, factory) ? "disabled" : ""}>Volver a fábrica</button>
      <button id="key-apply" class="primary" disabled>Aplicar</button>
      <span id="key-status" class="hint"></span>
    </p>`;

  const choose = (a: Assignment) => {
    pending = a;
    $("#key-choice").textContent = `${describeAssignment(a)}`;
    $<HTMLButtonElement>("#key-apply").disabled = sameAssignment(a, current);
    renderGrid();
  };

  let opts = allOptions();
  const renderGrid = () => {
    opts = allOptions();
    $("#macro-mode-row").hidden = pickerGroup !== "Macros";
    const q = $<HTMLInputElement>("#key-search").value.trim().toLowerCase();
    // Con búsqueda se filtra en todas las categorías; sin búsqueda, la pestaña elegida.
    const list = opts.map((o, i) => ({ o, i })).filter(({ o }) =>
      q ? o.label.toLowerCase().includes(q) : o.group === pickerGroup,
    );
    if (!q && pickerGroup === "Macros" && !lastMacros) {
      $("#picker-grid").innerHTML = `<p class="hint">Las macros todavía no se leyeron. <button id="picker-read-macros">Leer macros</button></p>`;
      $("#picker-read-macros").addEventListener("click", () =>
        run(async () => {
          $("#picker-grid").innerHTML = `<p class="hint">Leyendo macros…</p>`;
          try {
            lastMacroMem = await readMacroMemory();
            lastMacros = parseMacros(lastMacroMem);
            renderMacros();
          } finally {
            renderGrid();
          }
        }),
      );
      return;
    }
    $("#picker-grid").innerHTML = list.length
      ? list
          .map(({ o, i }) => {
            const cls = [pending && sameAssignment(o.value, pending) ? "chosen" : "", sameAssignment(o.value, current) ? "current" : ""];
            return `<button data-opt="${i}" class="${cls.join(" ").trim()}" title="${esc(o.group)}">${esc(o.label)}</button>`;
          })
          .join("")
      : `<p class="hint">Nada coincide con "${esc(q)}".</p>`;
  };

  detail.querySelectorAll<HTMLButtonElement>(".picker-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      pickerGroup = b.dataset.group!;
      $<HTMLInputElement>("#key-search").value = "";
      detail.querySelectorAll(".picker-tabs button").forEach((x) => x.classList.toggle("active", x === b));
      renderGrid();
    }),
  );
  $("#key-search").addEventListener("input", renderGrid);
  $("#macro-mode").addEventListener("change", () => {
    macroMode = Number($<HTMLSelectElement>("#macro-mode").value);
    // Si ya había una macro elegida, se actualiza su modo.
    if (pending?.[0] === 3) choose([3, macroMode, 1, pending[3]]);
    else renderGrid();
  });
  $("#picker-grid").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-opt]");
    if (b) choose(opts[Number(b.dataset.opt)].value);
  });
  $("#key-capture").addEventListener("click", () => (stopCapture ? stopCapture() : startCapture(choose)));
  $("#key-apply").addEventListener("click", () => pending && applyKey(key, pending));
  $("#key-factory").addEventListener("click", () => applyKey(key, factory));
  renderGrid();
}

/**
 * Captura la próxima tecla (con sus modificadores) desde el teclado físico.
 * Un modificador solo se toma al soltarlo, si no se apretó otra tecla mientras tanto.
 */
function startCapture(choose: (a: Assignment) => void) {
  const btn = $("#key-capture");
  btn.classList.add("armed");
  btn.textContent = "Escuchando… (tocá de nuevo para cancelar)";
  let lastMod = 0;
  const onDown = (e: KeyboardEvent) => {
    e.preventDefault();
    if (MOD_BY_CODE[e.code]) {
      lastMod = MOD_BY_CODE[e.code];
      return;
    }
    const code = HID_BY_CODE[e.code];
    stop();
    if (code) choose([0, modsFromEvent(e), 0, code]);
    else $("#key-choice").textContent = `"${e.code}" no se puede asignar desde acá: elegilo de la lista`;
  };
  const onUp = (e: KeyboardEvent) => {
    if (MOD_BY_CODE[e.code] && MOD_BY_CODE[e.code] === lastMod) {
      stop();
      choose([0, lastMod, 0, 0]);
    }
  };
  const stop = () => {
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keyup", onUp, true);
    btn.classList.remove("armed");
    btn.textContent = "⌨ Presioná una tecla…";
    stopCapture = null;
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  stopCapture = stop;
}

/** Lee la capa, cambia los 4 bytes de la tecla, escribe la capa entera y verifica releyendo. */
async function applyKey(key: Key, value: Assignment) {
  const status = $("#key-status");
  const layerId = currentLayer;
  const read = () => hid.query(Cmd.keymap, 0x01, { ...waking, args: [0x00, layerId << 4] });
  status.textContent = "Leyendo capa…";
  await run(async () => {
    try {
      const fresh = await read();
      const next = withAssignment(fresh, key, value);
      if (next.every((b, i) => b === fresh[i])) {
        status.textContent = "Ya tenía esa asignación.";
        return;
      }
      status.textContent = "Escribiendo…";
      await hid.writeBlock(Cmd.setKeymap, keymapPayload(next), { lenTag: layerId << 4, lastLen: trimmedLength });
      status.textContent = "Verificando…";
      const after = await read();
      layers.set(layerId, after);
      const ok = after.every((b, i) => b === next[i]);
      renderBoard();
      renderKey(key);
      $("#key-status").textContent = ok ? "Aplicado ✓" : "El teclado guardó otros valores: revisá la consola";
    } catch (e) {
      status.textContent = "Error: ver la consola HID";
      throw e;
    }
  });
}

renderBoard();

// ---------- Macros ----------

/** Macros leídas del teclado; su posición es el índice que usan las teclas ([03][modo][01][índice]). */
let lastMacros: Macro[] | null = null;
/** Memoria tal como se leyó, para detectar si cambió antes de escribir. */
let lastMacroMem: Uint8Array | null = null;

/** Lee las páginas necesarias de la memoria de macros (la tabla dice hasta dónde hay datos). */
async function readMacroMemory() {
  const page = (n: number) => hid.query(Cmd.macros, 0x01, { ...waking, args: [0x00, n << 4] });
  let mem = await page(0);
  const end = macroMemoryEnd(mem);
  for (let n = 1; n * MACRO_PAGE < end; n++) mem = new Uint8Array([...mem, ...(await page(n))]);
  return mem.slice(0, end);
}

/** Teclas (en las capas ya leídas) que llaman a la macro `idx`. */
function macroUsage(idx: number) {
  const uses: string[] = [];
  for (const [layerId, layer] of layers) {
    for (const key of keys) {
      const [type, mode, hi, lo] = keyAssignment(layer, key);
      if (type === 3 && hi === 1 && lo === idx) {
        const prefix = layerId === 0 ? "" : `${LAYERS[layerId].name} + `;
        uses.push(`${prefix}${key.label} (${MACRO_MODES.find((m) => m.mode === mode)?.short ?? mode})`);
      }
    }
  }
  return uses;
}

function renderMacros() {
  const list = $("#macro-list");
  if (!lastMacros) {
    list.innerHTML = `<p class="hint">Leé las macros para verlas. Se guardan en el teclado y las llama una tecla asignada en la pestaña Teclado.</p>`;
    return;
  }
  const layersRead = layers.size ? "" : " Leé las capas en la pestaña Teclado para ver qué tecla usa cada una.";
  $("#macros-status").textContent = `${lastMacros.length} macros · ${lastMacroMem?.length ?? 0} bytes.${layersRead}`;
  list.innerHTML = lastMacros
    .map((m, i) => {
      const uses = macroUsage(i);
      const ms = m.events.reduce((t, e) => t + e.delay, 0);
      return `<div class="panel macro">
        <div class="macro-head">
          <h3>${i + 1}. ${esc(m.name || "(sin nombre)")}</h3>
          <span class="hint">${m.events.length} eventos · ${ms} ms</span>
          <button data-edit="${i}">Regrabar</button>
        </div>
        <p class="hint">${uses.length ? `Asignada a: ${esc(uses.join(", "))}` : layers.size ? "No está asignada a ninguna tecla de las capas leídas." : ""}</p>
        <div class="macro-events">${m.events.map((e) => `<span class="${e.down ? "down" : "up"}" title="${e.delay} ms">${esc(describeMacroEvent(e))}</span>`).join("")}</div>
      </div>`;
    })
    .join("");
  list.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openMacroEditor(Number(b.dataset.edit))),
  );
}

$("#read-macros").addEventListener("click", () =>
  run(async () => {
    $("#macros-status").textContent = "Leyendo…";
    try {
      lastMacroMem = await readMacroMemory();
      lastMacros = parseMacros(lastMacroMem);
    } catch (e) {
      $("#macros-status").textContent = "No se pudo leer: ver la consola HID";
      throw e;
    }
    renderMacros();
  }),
);

$("#new-macro").addEventListener("click", () => openMacroEditor(null));

/** Editor: graba eventos del teclado físico con sus tiempos. `index` null = macro nueva. */
function openMacroEditor(index: number | null) {
  if (!lastMacros) {
    $("#macros-status").textContent = "Primero leé las macros: hay que conservarlas al guardar.";
    return;
  }
  const editing = index === null ? null : lastMacros[index];
  let events: MacroEvent[] = editing ? editing.events.map((e) => ({ ...e })) : [];
  let stopRec: (() => void) | null = null;
  const editor = $("#macro-editor");
  editor.hidden = false;
  editor.innerHTML = `
    <h3>${editing ? `Regrabar ${index! + 1}. ${esc(editing.name)}` : "Nueva macro"}</h3>
    <p class="assign">
      <label>Nombre <input id="macro-name" maxlength="15" value="${esc(editing?.name ?? `m${lastMacros.length + 1}`)}" /></label>
      <label class="check"><input id="macro-fixed" type="checkbox" checked /> Demora fija de</label>
      <input id="macro-delay" type="number" min="1" max="60000" value="10" style="width: 80px" /> ms
    </p>
    <p class="assign">
      <button id="macro-rec" class="primary">● Grabar</button>
      <button id="macro-clear">Borrar eventos</button>
      <span class="hint">Mientras graba, todo lo que tipees queda en la macro (no llega a la página).</span>
    </p>
    <div id="macro-preview" class="macro-events"></div>
    <p class="assign">
      <button id="macro-save" class="primary">Guardar en el teclado</button>
      <button id="macro-cancel">Cancelar</button>
      <span id="macro-status" class="hint"></span>
    </p>`;

  const preview = () => {
    $("#macro-preview").innerHTML = events.length
      ? events.map((e) => `<span class="${e.down ? "down" : "up"}" title="${e.delay} ms">${esc(describeMacroEvent(e))}</span>`).join("")
      : `<span class="hint">Sin eventos todavía.</span>`;
  };

  const record = () => {
    const btn = $("#macro-rec");
    btn.textContent = "■ Detener";
    btn.classList.add("armed");
    let last = 0;
    const push = (e: KeyboardEvent, down: boolean) => {
      if (e.repeat) return e.preventDefault();
      const code = MOD_KEY_BY_CODE[e.code] ?? HID_BY_CODE[e.code];
      if (!code) return;
      e.preventDefault();
      const now = performance.now();
      // La demora va en el evento anterior: es el tiempo hasta este.
      if (events.length && last) events[events.length - 1].delay = Math.max(1, Math.round(now - last));
      last = now;
      events.push({ down, kind: macroKeyKind(code), code, delay: 10 });
      preview();
    };
    const onDown = (e: KeyboardEvent) => push(e, true);
    const onUp = (e: KeyboardEvent) => push(e, false);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    stopRec = () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      btn.textContent = "● Grabar";
      btn.classList.remove("armed");
      stopRec = null;
    };
  };

  $("#macro-rec").addEventListener("click", () => (stopRec ? stopRec() : record()));
  $("#macro-clear").addEventListener("click", () => {
    events = [];
    preview();
  });
  $("#macro-cancel").addEventListener("click", () => {
    stopRec?.();
    editor.hidden = true;
  });
  $("#macro-save").addEventListener("click", async () => {
    stopRec?.();
    const name = $<HTMLInputElement>("#macro-name").value.trim();
    const status = $("#macro-status");
    if (!name) return void (status.textContent = "Poné un nombre.");
    if (!events.length) return void (status.textContent = "La macro no tiene eventos.");
    if ($<HTMLInputElement>("#macro-fixed").checked) {
      const d = Math.max(1, Math.min(60000, Number($<HTMLInputElement>("#macro-delay").value) || 10));
      events = events.map((e) => ({ ...e, delay: d }));
    }
    await saveMacro(index, { name, events }, status);
    if (status.textContent?.startsWith("Guardada")) editor.hidden = true;
  });
  preview();
}

/**
 * Relee la memoria (y aborta si cambió desde la última lectura), reemplaza o agrega la macro,
 * reescribe la memoria completa conservando las demás y verifica releyendo.
 */
async function saveMacro(index: number | null, macro: Macro, status: HTMLElement) {
  await run(async () => {
    try {
      status.textContent = "Leyendo memoria…";
      const fresh = await readMacroMemory();
      if (!lastMacroMem || fresh.length !== lastMacroMem.length || fresh.some((b, i) => b !== lastMacroMem![i])) {
        lastMacroMem = fresh;
        lastMacros = parseMacros(fresh);
        renderMacros();
        status.textContent = "Las macros del teclado cambiaron desde que las leíste: revisá la lista y volvé a guardar.";
        return;
      }
      const macros = parseMacros(fresh);
      if (index === null) macros.push(macro);
      else macros[index] = macro;
      const mem = buildMacros(macros);
      // La app oficial admite hasta 8 páginas de 512 bytes.
      if (mem.length > 8 * MACRO_PAGE) {
        status.textContent = `No entra: ${mem.length} bytes de ${8 * MACRO_PAGE}. Acortá la macro.`;
        return;
      }
      // Cada página es una tanda aparte: índice desde 0, total de la página y la página en el nibble alto
      // del largo (así lo hace la app de Windows; con índices continuos el teclado descarta la página 1).
      for (let page = 0; page * MACRO_PAGE < mem.length; page++) {
        status.textContent = `Escribiendo página ${page + 1}…`;
        await hid.writeBlock(Cmd.setMacros, mem.slice(page * MACRO_PAGE, (page + 1) * MACRO_PAGE), { lenTag: page << 4 });
      }
      status.textContent = "Verificando…";
      lastMacroMem = await readMacroMemory();
      lastMacros = parseMacros(lastMacroMem);
      const ok = lastMacroMem.length === mem.length && lastMacroMem.every((b, i) => b === mem[i]);
      renderMacros();
      status.textContent = ok
        ? `Guardada ✓ como macro ${index === null ? macros.length : index + 1}.`
        : "El teclado guardó otros datos: revisá la consola";
    } catch (e) {
      status.textContent = "Error: ver la consola HID";
      throw e;
    }
  });
}

renderMacros();

// ---------- Iluminación ----------

let selectedEffect: Effect = effects[0];
/** Última configuración leída del teclado, para precargar los controles. */
let lastConfig: Uint8Array | null = null;
/** Últimas paletas leídas (0x49). */
let lastColors: Uint8Array | null = null;

function renderEffects() {
  $("#effects").innerHTML = "";
  for (const fx of effects) {
    const b = document.createElement("button");
    b.textContent = fx.name;
    b.classList.toggle("selected", fx === selectedEffect);
    b.addEventListener("click", () => {
      selectedEffect = fx;
      renderEffects();
    });
    $("#effects").append(b);
  }

  const fx = selectedEffect;
  const current = lastConfig && fx.mode ? decodeConfigFor(lastConfig, fx.mode) : null;
  const pal = lastColors && fx.mode ? palette(lastColors, fx.mode) : null;
  const range = (id: string, label: string, value: number) =>
    `<label>${label} <input id="${id}" type="range" min="0" max="${LEVEL_MAX}" step="1" value="${value}" />
      <output class="mono">${value}</output></label>`;
  $("#effect-params").innerHTML = `
    <h3>${esc(fx.name)}</h3>
    <p class="hint mono">Modo ${fx.mode}${current ? "" : " · leé la configuración para ver los valores actuales"}</p>
    ${fx.brightness ? range("fx-brightness", "Brillo", current?.brightness ?? LEVEL_MAX) : ""}
    ${fx.speed ? range("fx-speed", "Velocidad", current?.speed ?? 2) : ""}
    ${fx.color || fx.multicolor ? paletteEditor(pal, current?.colorSource ?? 0, !!fx.multicolor) : ""}
    ${!fx.brightness && !fx.speed && !fx.multicolor ? `<p class="hint">Este efecto no tiene parámetros.</p>` : ""}
    <p><button id="fx-apply" class="primary" ${hid.find("output", VENDOR_REPORT) ? "" : "disabled"}>Aplicar</button>
      <span id="fx-status" class="hint"></span></p>`;

  $("#effect-params").querySelectorAll<HTMLInputElement>("input[type=range]").forEach((r) =>
    r.addEventListener("input", () => (r.nextElementSibling!.textContent = r.value)),
  );
  // Solo se escriben los lugares de la paleta que el usuario tocó.
  $("#effect-params").querySelectorAll<HTMLInputElement>("input[data-slot]").forEach((el) =>
    el.addEventListener("input", () => (el.dataset.dirty = "1")),
  );
  $("#effect-params")
    .querySelectorAll("input[name=fx-source]")
    .forEach((el) => el.addEventListener("change", updatePaletteMode));
  $("#fx-apply").addEventListener("click", () => applyLight(fx));
}

function paletteEditor(pal: Rgb[] | null, source: number, canAuto: boolean) {
  const colors = pal ?? DEFAULT_PALETTE;
  const slots = colors
    .map(
      (c, i) => `<label class="slot">
        <input type="color" data-slot="${i}" value="${rgbToHex(c)}" ${pal ? "" : "disabled"} />
        <span><input type="radio" name="fx-source" value="${i}" ${source === i ? "checked" : ""} /> ${i + 1}</span>
      </label>`,
    )
    .join("");
  return `
    <fieldset id="fx-palette" class="palette${source === AUTO_COLOR ? " auto" : ""}">
      <legend>Color</legend>
      <div class="slots">${slots}</div>
      ${canAuto ? `<label class="check"><input type="radio" name="fx-source" value="${AUTO_COLOR}" ${source === AUTO_COLOR ? "checked" : ""} /> Automático (colores de todo el espectro, ignora la paleta)</label>` : ""}
      <p class="hint">${
        pal
          ? "Elegí con el círculo qué color usa el efecto. Podés editar los 7 y guardarlos para usarlos después."
          : "Leé la configuración en Dispositivo para ver y editar tus colores."
      }</p>
    </fieldset>`;
}

function updatePaletteMode() {
  const auto = selectedSource() === AUTO_COLOR;
  $("#fx-palette").classList.toggle("auto", auto);
}

const selectedSource = () => {
  const el = document.querySelector<HTMLInputElement>("input[name=fx-source]:checked");
  return el ? Number(el.value) : undefined;
};

function decodeConfigFor(cfg: Uint8Array, mode: number) {
  const copy = cfg.slice();
  copy[ConfigOffset.effect] = mode;
  return decodeConfig(copy);
}

const inputValue = (sel: string) => {
  const el = document.querySelector<HTMLInputElement>(sel);
  return el ? Number(el.value) : undefined;
};

/** Lee, modifica solo los bytes del efecto, escribe el bloque entero y verifica releyendo. */
async function applyLight(fx: Effect) {
  const status = $("#fx-status");
  const btn = $<HTMLButtonElement>("#fx-apply");
  btn.disabled = true;
  status.textContent = "Leyendo configuración…";
  await run(async () => {
    try {
      const cfg = await hid.query(Cmd.config, 0x01, waking);
      const next = withLight(cfg, {
        mode: fx.mode,
        brightness: inputValue("#fx-brightness"),
        speed: inputValue("#fx-speed"),
        colorSource: selectedSource(),
      });
      status.textContent = "Escribiendo…";
      await hid.writeBlock(Cmd.setConfig, next);

      // Colores: solo los lugares que se tocaron y que difieren de lo guardado.
      const edited = new Map<number, Rgb>(
        [...document.querySelectorAll<HTMLInputElement>("#effect-params input[data-dirty]")].map((el) => [
          Number(el.dataset.slot),
          hexToRgb(el.value),
        ]),
      );
      let colorsOk = true;
      if (edited.size) {
        const colors = (await hid.query(Cmd.colors, 0x01, waking)).slice(0, COLOR_LEN);
        const current = palette(colors, fx.mode);
        for (const [slot, rgb] of edited) if (rgbToHex(current[slot]) === rgbToHex(rgb)) edited.delete(slot);
        if (edited.size) {
          const nextColors = withPaletteSlots(colors, fx.mode, edited);
          status.textContent = "Escribiendo colores…";
          await hid.writeBlock(Cmd.setColors, colorPayload(nextColors), { lastLen: trimmedLength });
          lastColors = (await hid.query(Cmd.colors, 0x01, waking)).slice(0, COLOR_LEN);
          colorsOk = lastColors.every((b, i) => b === nextColors[i]);
        } else {
          lastColors = colors;
        }
      }

      status.textContent = "Verificando…";
      lastConfig = await hid.query(Cmd.config, 0x01, waking);
      const ok = colorsOk && lastConfig.every((b, i) => b === next[i]);
      status.textContent = ok ? "Aplicado ✓" : "El teclado guardó otros valores: revisá la consola";
    } catch (e) {
      status.textContent = "Error: ver la consola HID";
      throw e;
    } finally {
      btn.disabled = false;
    }
  });
}

renderEffects();

// ---------- Paquetes ----------

$("#packets").innerHTML = Object.entries(packetNames)
  .map(([key, name]) => {
    const p = packets[key];
    if (!p) return "";
    const h = parseHeader(p);
    const body = p.slice(8, 8 + h.length);
    const lines = [];
    for (let i = 0; i < body.length; i += 16) lines.push(`${hex(i + 8, 4)}  ${hexBytes(body.slice(i, i + 16))}`);
    return `<div class="panel">
      <h3>${esc(name)} <span class="hint mono">${esc(key)}</span></h3>
      <dl class="mono">
        <dt>Report ID</dt><dd>0x${hex(h.reportId)}</dd>
        <dt>Comando</dt><dd>0x${hex(h.command)}</dd>
        <dt>Argumento</dt><dd>0x${hex(h.arg, 4)}</dd>
        <dt>¿?</dt><dd>0x${hex(h.unknown, 4)}</dd>
        <dt>Longitud</dt><dd>${h.length} bytes (paquete total ${p.length})</dd>
      </dl>
      <pre class="hexdump">${lines.join("\n")}</pre>
    </div>`;
  })
  .join("");

// ---------- Consola ----------

const logEl = $("#log");
const logLines: string[] = [];

function appendLog(e: LogEntry) {
  const t = e.time.toTimeString().slice(0, 8);
  const arrow = { in: "←", out: "→", "feature-get": "⇠", "feature-set": "⇢", info: "·", error: "!" }[e.dir];
  const rid = e.reportId !== undefined ? ` [0x${hex(e.reportId)}]` : "";
  const body = e.data ? hexBytes(e.data) : e.text ?? "";
  const line = `${t} ${arrow} ${e.dir}${rid} ${body}`;
  logLines.push(line);
  const div = document.createElement("div");
  div.className = e.dir;
  div.textContent = line;
  logEl.append(div);
  logEl.scrollTop = logEl.scrollHeight;
}
hid.onLog(appendLog);

$("#log-clear").addEventListener("click", () => {
  logLines.length = 0;
  logEl.innerHTML = "";
});
$("#log-copy").addEventListener("click", () => navigator.clipboard.writeText(logLines.join("\n")));

const parseId = (s: string) => {
  const n = parseInt(s.replace(/^0x/i, ""), 16);
  if (!(n >= 0 && n <= 0xff)) throw new Error(`Report ID inválido: "${s}"`);
  return n;
};

$("#read-feature").addEventListener("click", () =>
  run(() => hid.readFeature(parseId($<HTMLInputElement>("#read-id").value))),
);

// Escritura: checkbox + doble click para confirmar.
const writeEnabled = $<HTMLInputElement>("#write-enabled");
const sendBtn = $<HTMLButtonElement>("#send");
let armTimer: number | undefined;

const disarm = () => {
  clearTimeout(armTimer);
  sendBtn.classList.remove("armed");
  sendBtn.textContent = "Enviar";
};

writeEnabled.addEventListener("change", () => {
  $("#write-controls").classList.toggle("disabled", !writeEnabled.checked);
  disarm();
});

sendBtn.addEventListener("click", () => {
  if (!writeEnabled.checked) return;
  if (!sendBtn.classList.contains("armed")) {
    sendBtn.classList.add("armed");
    sendBtn.textContent = "Confirmar envío";
    armTimer = window.setTimeout(disarm, 4000);
    return;
  }
  disarm();
  run(async () => {
    const id = parseId($<HTMLInputElement>("#send-id").value);
    const data = parseHexInput($<HTMLInputElement>("#send-bytes").value);
    if ($<HTMLSelectElement>("#send-kind").value === "feature") await hid.sendFeature(id, data);
    else await hid.sendOutput(id, data);
  });
});

// Acceso desde la consola del navegador para depurar el protocolo.
if (import.meta.env.DEV) Object.assign(window, { g87: { hid, Cmd, withLight, decodeConfig } });

// Acceso desde la consola del navegador para depurar el protocolo.
if (import.meta.env.DEV) Object.assign(window, { g87: { hid, Cmd, withLight, decodeConfig } });

renderConnection();
