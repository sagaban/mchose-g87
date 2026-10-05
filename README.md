# MCHOSE G87 Configurator

Configurador web para el teclado **MCHOSE G87**, para usarlo desde macOS (o cualquier sistema con Chrome) sin la app
oficial "MCHOSE HUB", que solo existe para Windows.

Habla directo con el teclado por [WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API): no instala
nada, no necesita drivers y no se conecta a ningún servidor.

## Qué hace

- **Iluminación:** efecto, brillo, velocidad y color de cada efecto.
- **Paleta:** 7 colores editables por efecto; elegís cuál usa o el modo automático (todo el espectro).
- **Batería:** porcentaje y si está cargando, en el encabezado.
- **Sin sorpresas:** cada cambio se lee, se escribe solo lo necesario y se verifica releyendo el teclado.
- **Herramientas de análisis:** layout del teclado, paquetes de fábrica decodificados y una consola HID con log.

Probado con el G87 conectado por el **receptor 2.4 GHz** (USB `41e4:2001`). El modo por cable y el remapeo de teclas
todavía no están implementados.

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

**Configuración (128 bytes):**

- Offset `10`: efecto activo (número de modo, ver `src/data/g87.json`).
- Offset `0x38 + 2·modo`: brillo del efecto (0–4).
- Offset `0x38 + 2·modo + 1`: nibble alto = velocidad (0–4); nibble bajo = origen del color (`0`–`6` = lugar de la
  paleta, `7` = colores automáticos de todo el espectro, ignora la paleta).

**Colores (490 bytes):** 21 bytes por modo (`21·modo`), 7 colores RGB. Al escribir se agregan 28 bytes con la marca
`5A A5` y el último pedazo se manda con el largo sin los ceros finales.

**Batería:** `63 10` = 99 % con cable; `61 01` = 97 % a batería.

## Cómo se hizo

El protocolo salió de dos fuentes que coinciden:

- Análisis estático de la app oficial de Windows (C++/Qt 5) con [Ghidra](https://ghidra-sre.org/), y de los archivos
  de configuración que trae su instalador.
- [mchose-g87-controller-ubuntu](https://github.com/HoanNguyen1711/mchose-g87-controller-ubuntu), que lo sacó del
  driver web oficial y documentó la escritura.

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
