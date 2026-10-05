import { Hid, VENDOR_REPORT, describe, deviceLabel, type LogEntry } from "./hid";
import {
  Cmd,
  configDiff,
  decodeConfig,
  parseNotice,
  decodeKeyValue,
  effects,
  hex,
  hexBytes,
  keyBytes,
  keys,
  packetNames,
  packets,
  parseHeader,
  parseHexInput,
  step,
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
  $("#connect").hidden = on;
  $("#disconnect").hidden = !on;
  $("#kb-state").hidden = !hid.find("output", VENDOR_REPORT);

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
  renderConnection();
}

$("#connect").addEventListener("click", () => run(() => hid.request()));
$("#disconnect").addEventListener("click", () => run(() => hid.close()));

if (hid.supported) {
  navigator.hid.addEventListener("disconnect", (e) => {
    hid.devices = hid.devices.filter((d) => d !== e.device);
    appendLog({ time: new Date(), dir: "info", text: "El teclado se desconectó" });
    renderConnection();
  });
  run(() => hid.restore());
} else {
  $("#unsupported").hidden = false;
  $<HTMLButtonElement>("#connect").disabled = true;
}

// ---------- Estado (canal vendor 0x13) ----------

hid.onLog((e) => {
  if (e.dir !== "in" || e.reportId !== VENDOR_REPORT || !e.data) return;
  const n = parseNotice(e.data);
  if (n?.kind === "awake") $("#st-awake").textContent = n.awake ? "Despierto" : "Dormido (apretá una tecla)";
  if (n?.kind === "battery") $("#st-battery").textContent = `${n.percent} % (hipótesis)`;
});

const waking = {
  onSlow: () => ($("#st-awake").textContent = "Esperando respuesta… apretá una tecla para despertarlo"),
};

$("#read-version").addEventListener("click", () =>
  run(async () => {
    const v = await hid.query(Cmd.version, 0x01, waking);
    $("#st-version").textContent = hexBytes(v);
  }),
);

$("#read-config").addEventListener("click", () =>
  run(async () => {
    const cfg = await hid.query(Cmd.config, 0x01, waking);
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
        <dt>Color</dt><dd class="mono">${c.color} <span class="hint">(¿7 = multicolor?)</span></dd>
      </dl>
      <p class="hint">${cfg.length} bytes. Resaltado: distinto del valor de fábrica (${diff.length} bytes).</p>
      <pre class="hexdump">${lines.join("\n")}</pre>
      <table><thead><tr><th>Offset</th><th>Fábrica</th><th>Actual</th></tr></thead><tbody>
        ${diff.map((d) => `<tr class="mono"><td>${d.offset} (0x${hex(d.offset)})</td><td>${hex(d.factory)}</td><td>${hex(d.current)}</td></tr>`).join("")}
      </tbody></table>`;
  }),
);

// ---------- Teclado ----------

const board = $("#board");
for (const key of keys.filter((k) => !k.hidden)) {
  const el = document.createElement("button");
  el.className = "key";
  el.textContent = key.label;
  el.title = key.id;
  // Coordenadas del XML (lienzo de ~640×290) a porcentajes del contenedor.
  Object.assign(el.style, {
    left: `${(key.x / 640) * 100}%`,
    top: `${(key.y / 290) * 100}%`,
    width: `${(key.w / 640) * 100}%`,
    height: `${(key.h / 290) * 100}%`,
  });
  el.addEventListener("click", () => {
    board.querySelectorAll(".selected").forEach((s) => s.classList.remove("selected"));
    el.classList.add("selected");
    renderKey(key);
  });
  board.append(el);
}

function renderKey(key: Key) {
  const kv = decodeKeyValue(key.code);
  const b = keyBytes(key);
  $("#key-detail").className = "panel";
  $("#key-detail").innerHTML = `
    <h3>${esc(key.label)} <span class="hint mono">${esc(key.id)}</span></h3>
    <dl>
      <dt>KeyValue</dt><dd class="mono">0x${hex(key.code, 8)} → tipo ${hex(kv.type)}, mods ${hex(kv.modifiers)}, código HID 0x${hex(kv.code)}</dd>
      <dt>keypos</dt><dd class="mono">${key.keypos} → capa Fn por defecto: ${hexBytes(b.fnKeycode)}</dd>
      <dt>Diypos</dt><dd class="mono">${key.diypos} → color personalizado: ${hexBytes(b.diyColor)}</dd>
      <dt>Effectpos</dt><dd class="mono">${key.effectpos} → color base: ${hexBytes(b.baseColor)}</dd>
    </dl>
    <p class="hint">Los offsets salen del XML. Que los bytes de cada paquete correspondan a esta tecla es una hipótesis.</p>`;
}

// ---------- Iluminación ----------

let selectedEffect: Effect = effects[0];

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
  const range = (label: string, s: number) =>
    `<label>${label} <input type="range" min="0" max="${s * 4}" step="1" value="${s * 2}" /></label>`;
  $("#effect-params").innerHTML = `
    <h3>${esc(fx.name)}</h3>
    <p class="hint mono">ModelCode ${fx.mode} · NameCode ${fx.nameCode}</p>
    ${fx.brightness ? range("Brillo", step.brightness) : ""}
    ${fx.speed ? range("Velocidad", step.speed) : ""}
    ${fx.color ? `<label>Color <input type="color" value="#2f6fde" /></label>` : ""}
    ${fx.multicolor ? `<label class="check"><input type="checkbox" /> Multicolor</label>` : ""}
    ${!fx.brightness && !fx.speed && !fx.color ? `<p class="hint">Este efecto no tiene parámetros.</p>` : ""}
    <button class="primary" disabled title="Falta capturar el comando de iluminación">Aplicar</button>`;
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

renderConnection();
