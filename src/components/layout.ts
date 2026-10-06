// Posición de cada tecla del G87 en unidades de tecla (1u = una tecla normal), formato TKL ANSI.
// Reemplaza las coordenadas del XML oficial, que están medidas a ojo sobre una foto.

export interface KeyPlace {
  x: number;
  y: number;
  w?: number;
}

/** Ancho y alto totales en unidades. */
export const LAYOUT_W = 18.25;
export const LAYOUT_H = 6.25;

const NAV = 15.25; // primera columna del bloque de navegación

/** Fila de teclas consecutivas desde `x`; cada elemento es un id o [id, ancho]. */
function row(y: number, x: number, keys: (string | [string, number])[]) {
  const out: Record<string, KeyPlace> = {};
  for (const k of keys) {
    const [id, w] = typeof k === "string" ? [k, 1] : k;
    out[id] = { x, y, ...(w !== 1 && { w }) };
    x += w;
  }
  return out;
}

const L = (c: string) => `KEY_${c}`;

export const LAYOUT: Record<string, KeyPlace> = {
  // Fila de funciones: Esc, separación de 1u y bloques de 4 con media unidad entre bloques.
  ...row(0, 0, [L("ESC")]),
  ...row(0, 2, ["F1", "F2", "F3", "F4"].map(L)),
  ...row(0, 6.5, ["F5", "F6", "F7", "F8"].map(L)),
  ...row(0, 11, ["F9", "F10", "F11", "F12"].map(L)),
  ...row(0, NAV, ["PRINT", "SCRLOCK", "PAUSE"].map(L)),

  ...row(1.25, 0, [
    L("TILDE"),
    ..."1234567890".split("").map(L),
    L("Underscore"),
    L("EqualSign"),
    [L("Backspace"), 2],
  ]),
  ...row(1.25, NAV, ["INS", "HOME", "PGUP"].map(L)),

  ...row(2.25, 0, [[L("TAB"), 1.5], ..."QWERTYUIOP".split("").map(L), L("L_Brackets"), L("R_Brackets"), [L("Slash"), 1.5]]),
  ...row(2.25, NAV, ["DEL", "END", "PGDN"].map(L)),

  ...row(3.25, 0, [[L("CAPSLOCK"), 1.75], ..."ASDFGHJKL".split("").map(L), L("Semicolon"), L("Quotation"), [L("ENTER"), 2.25]]),
  // El knob va debajo de PgDn.
  KEY_020000e2: { x: NAV + 2, y: 3.25 },

  ...row(4.25, 0, [[L("L_SHIFT"), 2.25], ..."ZXCVBNM".split("").map(L), L("COMMA"), L("PERIOD"), L("Interrogation"), [L("R_SHIFT"), 2.75]]),
  ...row(4.25, NAV + 1, [L("UpArrow")]),

  ...row(5.25, 0, [
    [L("L_CTRL"), 1.25],
    [L("L_WIN"), 1.25],
    [L("L_ALT"), 1.25],
    [L("SPACEBAR"), 6.25],
    [L("R_ALT"), 1.25],
    [L("Fn1"), 1.25],
    [L("APP"), 1.25],
    [L("R_CTRL"), 1.25],
  ]),
  ...row(5.25, NAV, ["LeftArrow", "DownArrow", "RightArrow"].map(L)),
};
