// Convierte los archivos del instalador oficial (vendor/) a JSON para la app.
// Uso: pnpm extract
import { readFileSync, writeFileSync } from "node:fs";

const vendor = new URL("../vendor/", import.meta.url);
const out = new URL("../src/data/g87.json", import.meta.url);

const read = (p) => readFileSync(new URL(p, vendor), "utf8");
const attrs = (tag) =>
  Object.fromEntries([...tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));

// Strings en inglés: <组件 ID="81" Code="Fixed on"/>
const strings = Object.fromEntries(
  [...read("Lingual_English.xml").matchAll(/<组件 ID="(\d+)" Code="([^"]*)"\/>/g)].map((m) => [m[1], m[2]]),
);
// Nombres de tecla por HID usage: Key0x2d="-\n_"
const keyNames = Object.fromEntries(
  [...read("G87/StudioKeyValue.ini").matchAll(/^Key0x([0-9a-f]+)\s*="(.*)"/gim)].map((m) => [
    parseInt(m[1], 16),
    m[2].replaceAll("\\n", " ").replaceAll("\\\\", "\\").replace("''", "\""),
  ]),
);
// "@N" en KeyName apunta a un recurso de la app, no al XML de idioma: se usa el nombre por código.
// Nombres cortos para que entren en la tecla. Las flechas en StudioKeyValue son estilos CSS de Qt, no texto.
const pretty = {
  "↑": [0x52], "↓": [0x51], "←": [0x50], "→": [0x4f],
  Esc: ["ESC"], Caps: ["CAPSLOCK"], Shift: ["L_SHIFT", "R_SHIFT"], Ctrl: ["L_CTRL", "R_CTRL"],
  Win: ["L_WIN"], Alt: ["L_ALT", "R_ALT"], Fn: ["Fn1"], Menu: ["APP"], Space: ["SPACEBAR"],
  Tab: ["TAB"], Enter: ["ENTER"], Ins: ["INS"], Del: ["DEL"], Home: ["HOME"], End: ["END"],
  PgUp: ["PGUP"], PgDn: ["PGDN"], PrtSc: ["Prt"], ScrLk: ["Solk"], Pause: ["PAUSE"], "⌫": ["Backspace"],
};
const label = (name, code) => {
  if (name === "@27") return "Knob"; // KeyValue 0x020000e2 = consumer Mute
  const resolved = name.startsWith("@") ? keyNames[code] ?? name : name;
  const short = Object.entries(pretty).find(([, from]) => from.includes(code) || from.includes(resolved));
  return short ? short[0] : resolved;
};

// Nombres para elegir asignaciones: solo los que son texto (las flechas son estilos de Qt).
const hidNames = Object.fromEntries(
  Object.entries(keyNames)
    .map(([code, name]) => [
      code,
      // Teclado numérico (0x54–0x63): prefijo para no confundir con la fila de números.
      +code >= 0x54 && +code <= 0x63 ? `Num ${name}` : Object.entries(pretty).find(([, from]) => from.includes(+code) || from.includes(name))?.[0] ?? name,
    ])
    .filter(([, name]) => !name.startsWith("image:")),
);

const xml = read("G87/G87_KeyBoed.xml");

// Solo el primer bloque <KeyArrs>; el resto del archivo es un bloque comentado.
const keyArrs = xml.slice(xml.indexOf("<KeyArrs>"), xml.indexOf("</KeyArrs>"));
const keys = [...keyArrs.matchAll(/<SubKey\b[^>]*\/>/g)].map((m) => {
  const a = attrs(m[0]);
  const code = parseInt(a.KeyValue, 16);
  return {
    id: a.KeyText,
    label: label(a.KeyName, code),
    code,
    x: +a.x,
    y: +a.y,
    w: +a.width,
    h: +a.height,
    keypos: +a.keypos,
    diypos: +a.Diypos,
    effectpos: +a.Effectpos,
    // CODE42/45/56: teclas ISO que no existen en el G87 ANSI.
    ...(a.KeyName.startsWith("CODE") && { hidden: true }),
  };
});

const effects = [...xml.matchAll(/<Effect\s[^>]*\/>/g)].map((m) => {
  const a = attrs(m[0]);
  const edit = a.EditModel.split(",");
  return {
    nameCode: +a.NameCode,
    name: strings[a.NameCode] ?? a.other,
    mode: +a.ModelCode,
    brightness: edit.some((e) => e === "EDIT_L" || e === "EDIT_A"),
    speed: edit.some((e) => e === "EDIT_S" || e === "EDIT_A"),
    color: edit.some((e) => e === "EDIT_C" || e === "EDIT_A"),
    multicolor: edit.some((e) => e === "EDIT_M" || e === "EDIT_A"),
  };
});

const params = attrs(xml.match(/<parameterAddrs\b[^>]*\/>/)[0]);
delete params.other;
const step = attrs(xml.match(/<EffectStep\b[^>]*\/>/)[0]);

// Paquetes HID por defecto guardados en G87_data.ini: clave="06,84,..."
const ini = read("G87/G87_data.ini");
const packets = {};
let section = "";
for (const line of ini.split(/\r?\n/)) {
  const s = line.match(/^\[(.+)\]$/);
  if (s) section = s[1];
  const kv = line.match(/^(\w+)="([0-9a-fA-F,]+)"$/);
  if (kv) packets[`${section}.${kv[1]}`] = kv[2].split(",").map((b) => parseInt(b, 16));
}

writeFileSync(
  out,
  JSON.stringify(
    { keys, effects, params, step: { brightness: +step.luminanceStep, speed: +step.Speed }, packets, keyNames: hidNames },
    null,
    1,
  ),
);
console.log(`${keys.length} teclas, ${effects.length} efectos, ${Object.keys(packets).length} paquetes → ${out.pathname}`);
