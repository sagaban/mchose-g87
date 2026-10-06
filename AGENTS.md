# AGENTS.md

Contexto para agentes de IA que trabajen en este repo. Para el usuario final, ver `README.md` (que además documenta el
protocolo con detalle).

## Qué es

Configurador web del teclado **MCHOSE G87** (TKL, tri-modo: receptor 2.4G, Bluetooth y cable) que reemplaza a la app
oficial "MCHOSE HUB", que solo existe para Windows. Habla con el teclado por **WebHID** desde Chrome/Edge/Brave.
Publicado como PWA en GitHub Pages: https://sagaban.github.io/mchose-g87/

El protocolo se obtuvo por ingeniería inversa, cruzando tres fuentes, y **cada comando que usa la app se verificó
contra un G87 real**:

1. La app oficial de Windows (C++/Qt 5.7, 32 bits), analizada con Ghidra en modo headless.
2. El driver web oficial (M HUB), en https://www.mchose.com.cn/; el bundle con el protocolo es `assets/purify.es-*.js`.
   Tiene la tabla completa de comandos (`getPerformance`, `setKeySetting`, `setMacro`, `getDiyLight`…).
3. https://github.com/HoanNguyen1711/mchose-g87-controller-ubuntu (MIT), que lo sacó del driver web.

**El driver web y el proyecto de Ubuntu tienen errores** (ver "Lecciones"); ante una duda, gana lo verificado contra
el teclado.

## Stack y comandos

- **Solid** + **Park UI** (componentes sobre Ark UI) + **Panda CSS 1.x**, Vite 8, TypeScript 7, **pnpm** (no usar npm).
- `pnpm install` (corre `panda codegen` por `prepare`), `pnpm dev`, `pnpm build`, `pnpm exec tsc`.
- `pnpm extract` regenera `src/data/g87.json` desde los archivos del instalador oficial en `vendor/` (en `.gitignore`:
  son del fabricante, no se suben).
- Cada push a `main` se publica en GitHub Pages (`.github/workflows/deploy.yml`).
- No hay tests automáticos: la verificación es manual, contra el teclado (ver "Cómo probar").

## Estructura

```
src/hid.ts           WebHID: conexión, cola de operaciones, pedidos multi-paquete, escritura en pedazos, cable
src/device.ts        operaciones independientes de la conexión (elige receptor o cable)
src/protocol.ts      formatos: configuración, colores, mapa de teclas, macros, batería, avisos, nombres
src/state.ts         estado compartido (signals/stores de Solid): conexión, datos leídos, log
src/App.tsx          encabezado, avisos y pestañas
src/tabs/            una pestaña por archivo
src/components/      teclado dibujado (layout.ts = TKL en unidades), selector de asignación, editores
src/components/ui/   componentes de Park UI (generados por su CLI; se pueden editar)
src/theme/           tema de Park UI (colores, tokens, recetas)
src/data/g87.json    layout, efectos y paquetes de fábrica (generado por scripts/extract-vendor.mjs)
styled-system/       generado por Panda (no editar, no se sube)
```

Regla de capas: **solo `hid.ts` usa WebHID** y solo `device.ts` decide el transporte. Las pestañas llaman a `device`
y a `state`, nunca a `hid.query`/`writeBlock` directo (excepto la consola HID). Eso es lo que permitiría, por ejemplo,
un backend nativo (Tauri + hidapi) reemplazando solo `hid.ts`.

## Protocolo, en corto

Ver `README.md` → "Protocolo" para el detalle y las tablas.

- **Receptor 2.4G** (USB `41e4:2001`): report `0x13` de 20 bytes `[0x13][cmd][total][índice][largo][14 datos][checksum]`,
  checksum = suma de los bytes 0..18 incluido el report ID. Leer = `[cmd, 0x01, args…]`; el teclado responde en varios
  paquetes. Escribir = bloque en pedazos de 14 bytes, cada uno confirmado por eco. Comandos de lectura = escritura | 0x40.
- **Cable** (USB `41e4:2201`, selector del teclado en modo cable): feature report `0x06` de 519 bytes
  `[cmd][encabezado de 6][datos]`. Leer = SET_FEATURE con `cmd | 0x80` + GET_FEATURE.
- **Configuración** (128 bytes): offset 9 `lightType`, 10 efecto, 27 modo Windows(0)/Mac(2), `0x38 + 2·modo` el par
  `[brillo][velocidad<<4 | origen del color]` de cada efecto, `96 + modo` el brillo de los efectos con color por tecla.
- **Mapa de teclas**: 3 capas (Default, Fn, Fn2) de 504 bytes; 4 bytes por tecla `[tipo][mods][hi][lo]`, por columnas;
  offset = `keypos - 8` del XML oficial. Tipos: 00 tecla, 02 multimedia, 03 macro, 07/08 funciones del firmware, 0D Fn.
- **Macros**: memoria con tabla `[dirección][largo]` + `[largo nombre][nombre][eventos de 4 bytes]`, por páginas de 512.
- **Color por tecla** (Self-define): tablas R, G, B de 126 bytes; posición = la del mapa de teclas.

## Lecciones (cosas que costaron y no son obvias)

- **Macros, escritura por páginas**: cada página de 512 bytes va en una tanda propia con el índice de pedazo empezando
  en 0 y la página en el nibble alto del largo. Con índices continuos (como hacen el driver web y el proyecto de
  Ubuntu) el teclado descarta todo lo que pasa de 512 bytes y deja la página 1 corrupta.
- **Nunca dos pedidos en vuelo**: dos lecturas del mismo comando mezclan respuestas (pasó al leer tres capas en
  paralelo). `hid.ts` serializa todo con una cola; no la saltees. La lectura de capas además filtra por capa.
- **Self-define (efecto 21) necesita `lightType = 1`** (offset 9); sin eso el teclado apaga la luz. Su brillo no va en
  el par del efecto sino en el offset `96 + modo`.
- **El origen del color** (nibble bajo del par): 0–6 = lugar de la paleta, 7 = colores automáticos de todo el espectro
  (ignora la paleta). No es "recorrer la paleta" como dice el proyecto de Ubuntu.
- **El modo Windows/Mac no reescribe las capas**: el firmware intercambia Win/Alt y F1–F12 al vuelo.
- **El teclado se duerme** al minuto sin uso y no contesta; el receptor guarda el pedido y, al despertar, a veces
  pierde partes de la respuesta. Por eso los pedidos se reenvían cada 2,5 s y esperan hasta 60 s.
- **Chrome pierde el permiso** cuando el receptor se reinicia (no informa número de serie): hay que volver a
  autorizar. En macOS, una sola pestaña/app puede tener abierta la interfaz.
- **En macOS Chrome incluye el report ID** al principio de `receiveFeatureReport`; en otros sistemas no.
- **El driver web convierte comandos de texto en decimal**: su `"10"` para colores por cable es `0x0A`.
- **Por cable la batería informa 0 %**; solo se sabe si carga.

## Seguridad al tocar el teclado

Esto escribe en la memoria del dispositivo de alguien. Reglas que se siguieron siempre y conviene mantener:

1. **Nunca mandar comandos de actualización de firmware** ni probar comandos desconocidos a ciegas.
2. **Leer, modificar solo lo necesario, escribir el bloque completo y verificar releyendo.** Antes de escribir, releer
   y abortar si el bloque cambió desde que se mostró (ver `apply` en las pestañas).
3. **Un comando de escritura nuevo se valida primero reescribiendo los mismos datos que se leyeron** (sin cambios),
   con un respaldo guardado, y recién después se prueba un cambio real.
4. Para descubrir dónde vive un dato: leer, pedir al usuario que lo cambie desde el teclado (atajos Fn) y comparar.
   Es más seguro que adivinar offsets.

## Cómo probar

- `pnpm dev` y Chrome en `localhost` (WebHID requiere contexto seguro; localhost cuenta).
- En desarrollo, `window.g87` expone `state` y `protocol` (incluye `device`, `hid`, `keys`, `parseMacros`…) para
  probar el protocolo desde la consola.
- La pestaña "Consola HID" muestra todo lo enviado y recibido.
- Sin teclado se puede revisar la interfaz; la pestaña "Paquetes" y "Atajos" muestran datos de fábrica.

## Herramientas y trampas del entorno

- **Panda CSS 1.x, no 2.x**: los componentes de Park UI usan `createStyleContext`/`RecipeConfig`, que Panda 2 cambió.
- **TypeScript 7 no acepta `baseUrl`**, pero la CLI de Park UI (`pnpm dlx @park-ui/cli add <componente>`) lo exige.
  Agregarlo temporalmente en `tsconfig.json` solo para correr la CLI, y después cambiar los imports `~/theme/...` que
  la CLI escribe en `panda.config.ts` por `./src/theme/...` (el bundler de Panda no resuelve el alias).
- La CLI de Park UI es interactiva: en entornos sin TTY hay que simular la terminal.
- `gridAutoRows="8"` en Panda se toma como 8 px, no como el token de espaciado: usar valores explícitos (`"2rem"`).
- El tooltip de Park UI envuelve a su hijo en un botón: para chips que ya son botones, usar Ark UI directo
  (ver `components/OptionChip.tsx`).
- `vite preview` usa la misma `base` que el build (`/mchose-g87/`); `BASE_PATH` la cambia.

## Sin verificar todavía

- Escritura de colores por tecla por el receptor (comando `0x02`); por cable funciona.
- Renumerar teclas al borrar una macro del medio (la lógica está; no se probó con datos reales).
- Efecto 19 (el driver lo trata como de color por tecla, pero no aparece en la lista de efectos del G87).
- Fn+G (`07 00 00 0A`): no está en el manual.
- Escritura de los ajustes de la pestaña Ajustes: tasa de sondeo (offset 1), Top Speed (3), bloqueo de Win (15) y
  suspensión (24). Se leen bien (coinciden con el teclado); los valores salen del driver oficial, pero escribirlos no
  se probó todavía. El modo Windows/Mac (27) sí está verificado.

## Convenciones

- Interfaz, comentarios, README y mensajes de commit **en español** (rioplatense).
- Comentarios que explican el porqué (formato del protocolo, decisiones), no el qué.
- Commits chicos y descriptivos; un commit por cambio verificado.
