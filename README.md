# MCHOSE G87 Configurator

Configurador web para el teclado **MCHOSE G87**, para usarlo desde macOS (o cualquier sistema con Chrome) sin la app
oficial "MCHOSE HUB", que solo existe para Windows.

Habla directo con el teclado por [WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API): no instala
nada, no necesita drivers y no se conecta a ningún servidor.

## Qué hace

- **Iluminación:** efecto, brillo, velocidad y color de cada efecto.
- **Paleta:** 7 colores editables por efecto; elegís cuál usa o el modo automático (todo el espectro).
- **Batería:** porcentaje y si está cargando, en el encabezado.
- **Remapeo de teclas:** en las capas Default, Fn y Fn2; cualquier tecla puede ser otra tecla, un modificador o una
  función multimedia, y se puede volver a la asignación de fábrica.
- **Macros:** lee las macros guardadas en el teclado (y qué tecla usa cada una), graba nuevas o regraba existentes
  conservando las demás, y las asigna a una tecla con su modo de reproducción.
- **Sin sorpresas:** cada cambio se lee, se escribe solo lo necesario y se verifica releyendo el teclado.
- **Herramientas de análisis:** layout del teclado, paquetes de fábrica decodificados y una consola HID con log.

Probado con el G87 conectado por el **receptor 2.4 GHz** (USB `41e4:2001`). El modo por cable todavía no está
implementado.

## Requisitos

- Un navegador con WebHID: **Chrome, Edge, Brave u Opera** de escritorio. Safari y Firefox no lo soportan.
- Node.js 22+ y [pnpm](https://pnpm.io/) para correrlo localmente.

## Uso

```sh
pnpm install
pnpm dev
```

Abrí http://localhost:5173 en Chrome, tocá **Conectar** y elegí "MCHOSE 2.4G Wireless".

1. En **Dispositivo**, tocá **Leer configuración** para cargar tus valores actuales.
2. En **Iluminación**, elegí un efecto, ajustalo y tocá **Aplicar**.
3. En **Teclado**, elegí la capa, tocá **Leer capa**, después una tecla, y asignale lo que quieras.
4. En **Macros**, tocá **Leer macros** y después **Nueva macro** o **Regrabar**; asignala desde la pestaña Teclado.

Algunas cosas a saber:

- **El teclado se duerme** al minuto sin uso, y dormido no contesta. Si la app dice "Dormido", apretá cualquier tecla.
- **Si el receptor se desconecta o se reinicia**, Chrome pierde el permiso (el receptor no informa número de serie) y
  hay que tocar **Volver a conectar**.
- **Solo una pestaña o app puede usar el teclado a la vez.** Si no conecta, cerrá otras pestañas con el configurador.

## Protocolo

Todo pasa por el report HID **`0x13`** de la interfaz vendor (usage page `0xFF02`), con paquetes de 20 bytes:

```
[0x13] [cmd] [total] [índice] [largo] [datos × 14] [checksum]
checksum = (0x13 + suma de los 18 bytes anteriores) & 0xFF
```

- **Lectura:** se manda `[cmd, 0x01]` y el teclado responde con `total` paquetes de hasta 14 bytes de datos.
- **Escritura:** el bloque va en pedazos de 14 bytes; el teclado confirma cada uno devolviéndolo como eco.
- **Avisos:** paquetes con `cmd = 0x0A` que el teclado manda solo: despierto/dormido, batería, cambio de iluminación.

| Bloque | Lectura | Escritura | Tamaño |
|---|---|---|---|
| Versión | `0x05` | — | 10 bytes |
| Configuración: efecto activo y parámetros de cada efecto | `0x44` | `0x04` | 128 bytes |
| Colores: paleta de 7 colores RGB por efecto | `0x49` | `0x09` | 490 bytes (+ cola `5A A5` al escribir) |
| Batería: `[nivel %][estado]` | `0x4A` | — | 2 bytes |
| Mapa de teclas de una capa | `0x41` | `0x01` | 504 bytes (512 con la cola `5A A5` al escribir) |
| Memoria de macros, por páginas | `0x43` | `0x03` | páginas de 512 bytes |

**Configuración (128 bytes):**

- Offset `10`: efecto activo (número de modo, ver `src/data/g87.json`).
- Offset `0x38 + 2·modo`: brillo del efecto (0–4).
- Offset `0x38 + 2·modo + 1`: nibble alto = velocidad (0–4); nibble bajo = origen del color (`0`–`6` = lugar de la
  paleta, `7` = colores automáticos de todo el espectro, ignora la paleta).

**Colores (490 bytes):** 21 bytes por modo (`21·modo`), 7 colores RGB. Al escribir se agregan 28 bytes con la marca
`5A A5` y el último pedazo se manda con el largo sin los ceros finales.

**Batería:** `63 10` = 99 % con cable; `61 01` = 97 % a batería.

**Mapa de teclas:** la lectura lleva la capa en los argumentos (`41 01 00 YY`, con `YY` = `00` Default, `10` Fn,
`20` Fn2) y la escritura en el nibble alto del byte de largo (`capa<<4 | largo`). Cada tecla ocupa 4 bytes
`[tipo][modificadores][código alto][código bajo]`, ordenadas por columnas (el offset es el `keypos` del XML menos 8):
tipo `00` = tecla HID con modificadores, `02` = multimedia (código de 16 bits), `0D` = Fn, `03`/`07`/`08` = funciones
del teclado (sistema, iluminación). En modo Mac el propio teclado guarda Win y Alt intercambiadas.

**Macros:** se leen por página (`43 01 00 YY`, con `YY` = página<<4). La memoria empieza con una tabla de
`[dirección LE][largo LE]` por macro; en cada dirección va `[largo del nombre][nombre UTF-8][eventos]`. Cada evento
ocupa 4 bytes: `[flags][demora][demora][código]`, con bit 7 = soltar, bits 4–6 = tipo (0 tecla, 1 modificador u
otra, 2 mouse) y una demora de 20 bits en ms. Una tecla llama a una macro con `[03][modo][01][índice]`, modo `1` =
una vez, `4` = mientras se mantiene, `2` = hasta volver a apretar.

Al escribir, **cada página de 512 bytes va en una tanda propia** con el índice de pedazo empezando de nuevo en 0 y la
página en el nibble alto del largo. Con índices continuos (como hace el driver web) el teclado descarta todo lo que
pasa de los primeros 512 bytes.

## Cómo se hizo

El protocolo salió de dos fuentes que coinciden:

- Análisis estático de la app oficial de Windows (C++/Qt 5) con [Ghidra](https://ghidra-sre.org/), y de los archivos
  de configuración que trae su instalador.
- [mchose-g87-controller-ubuntu](https://github.com/HoanNguyen1711/mchose-g87-controller-ubuntu), que lo sacó del
  driver web oficial y documentó la escritura.
- El propio driver web oficial (M HUB), para el mapa de teclas.

Cada comando que usa la app se verificó contra un G87 real.

`scripts/extract-vendor.mjs` regenera `src/data/g87.json` (layout, efectos y paquetes de fábrica) a partir de los
archivos del instalador oficial puestos en `vendor/`:

```sh
pnpm extract
```

## Proyecto

```
src/hid.ts           conexión WebHID, lectura/escritura multi-paquete, reintentos y desconexiones
src/protocol.ts      formatos: configuración, colores, batería, avisos
src/main.ts          interfaz
src/data/g87.json    layout, efectos y paquetes de fábrica (generado)
scripts/             extracción de datos del instalador oficial
```

## Licencia

[MIT](LICENSE)

## Aviso

Proyecto independiente, sin relación con MCHOSE. Escribir en el teclado conlleva riesgos: usalo bajo tu propia
responsabilidad. La app nunca manda comandos de actualización de firmware.
