import {
  Battery,
  Bluetooth,
  Calculator,
  Command,
  Gauge,
  Globe,
  Lightbulb,
  Lock,
  Mail,
  Monitor,
  Palette,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Star,
  SunDim,
  SunMedium,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-solid";
import type { JSX } from "solid-js";
import { css } from "styled-system/css";
import { hexBytes, type Assignment } from "~/protocol";

type IconSpec = { icon: (p: { class?: string }) => JSX.Element; mark?: string };

/** Multimedia (tipo 02): código de 16 bits → ícono. */
const CONSUMER_ICONS: Record<number, IconSpec> = {
  0xe2: { icon: VolumeX },
  0xe9: { icon: Volume2 },
  0xea: { icon: Volume1 },
  0xcd: { icon: (p) => (<span class={css({ display: "inline-flex" })}><Play {...p} /><Pause {...p} /></span>) },
  0xb5: { icon: SkipForward },
  0xb6: { icon: SkipBack },
  0xb7: { icon: Square },
  0x6f: { icon: SunMedium },
  0x70: { icon: SunDim },
  0x192: { icon: Calculator },
  0x18a: { icon: Mail },
  0x194: { icon: Monitor },
  0x223: { icon: Globe },
  0x22a: { icon: Star },
};

/** Funciones del firmware (tipos 07/08) → ícono y, si hace falta, una marca (+, −, número). */
const FIRMWARE_ICONS: Record<string, IconSpec> = {
  "07 00 00 01": { icon: Lock },
  "07 00 00 04": { icon: RotateCcw },
  "07 00 00 05": { icon: Bluetooth, mark: "1" },
  "07 00 00 06": { icon: Bluetooth, mark: "2" },
  "07 00 00 07": { icon: Bluetooth, mark: "3" },
  "07 00 00 08": { icon: Radio },
  "07 00 00 11": { icon: Battery },
  "07 00 00 18": { icon: Monitor, mark: "Win" },
  "07 00 00 1a": { icon: Command, mark: "Mac" },
  "08 00 00 00": { icon: Sparkles },
  "08 02 00 00": { icon: Palette },
  "08 03 01 00": { icon: Lightbulb, mark: "+" },
  "08 03 02 00": { icon: Lightbulb, mark: "−" },
  "08 04 01 00": { icon: Gauge, mark: "+" },
  "08 04 02 00": { icon: Gauge, mark: "−" },
};

export function iconFor(a: Assignment): IconSpec | null {
  if (a[0] === 2) return CONSUMER_ICONS[(a[2] << 8) | a[3]] ?? null;
  if (a[0] === 7 || a[0] === 8) return FIRMWARE_ICONS[hexBytes(a).toLowerCase()] ?? null;
  return null;
}

const iconClass = css({ boxSize: "1.35em", flexShrink: 0 });

/** Ícono de la asignación con su marca, o null si no tiene ícono (se usa el texto corto). */
export default function AssignmentIcon(props: { spec: IconSpec }) {
  return (
    <span class={css({ display: "inline-flex", alignItems: "center", gap: "0.5" })}>
      <props.spec.icon class={iconClass} />
      {props.spec.mark && <span class={css({ fontSize: "0.85em" })}>{props.spec.mark}</span>}
    </span>
  );
}
