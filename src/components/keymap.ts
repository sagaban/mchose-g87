import { packets, type Assignment, type Key } from "~/protocol";

/** Asignación de fábrica: capa Default = KeyValue del XML, capa Fn = paquete Fn_default del INI. */
export function factoryAssignment(key: Key, layer: number): Assignment {
  if (layer === 0) return [key.code >>> 24, (key.code >> 16) & 0xff, (key.code >> 8) & 0xff, key.code & 0xff];
  if (layer === 1) return [...packets["Fn_default.KeyCode"].slice(key.keypos, key.keypos + 4)] as Assignment;
  return [0, 0, 0, 0];
}

export const sameAssignment = (a: Assignment, b: Assignment) => a.every((x, i) => x === b[i]);
