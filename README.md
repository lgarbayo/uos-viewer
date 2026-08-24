# uos-viewer

Visor de referencia del formato **Unified Oral Scene** (`.uos`), Layer 1: visualización y
medición manual, **sin inferencia**.

Abre un contenedor `.uos` **sin saber nada de quién lo escribió**: lee el manifiesto,
resuelve los assets por prioridad de carga, y baja de la red sólo lo que va a enseñar. Es
el punto de que UOS sea un formato y no *el formato de alguien*.

```bash
npm install
npm run dev          # arrastra un .uos a la ventana
npm test             # los tests del lector (ver más abajo)
```

## Qué lo separa de un visor cualquiera

**No recibe una lista de ficheros: recibe un contenedor y lo interroga.**

Un `.uos` es un ZIP **sin comprimir** con el directorio central al final, y eso no es un
detalle de empaquetado: es lo que permite leer el índice —unos pocos KB— y bajar **un asset
suelto** sin traerse el caso entero. Sobre un caso real con CBCT, leer un corte de la serie
son unos KB frente a los 299 MB del contenedor.

`ZipReader` implementa esa lectura por rangos contra tres orígenes —HTTP, un `File` que el
usuario arrastra, o el disco en Node— detrás de una interfaz de dos métodos. Y falla
ruidosamente donde el spec lo exige:

- **`manifest.json` tiene que ser la primera entrada física.** Es la identificación
  positiva del formato; la extensión del fichero no prueba nada.
- **Sólo STORE.** Un `.uos` con entradas deflate rompe el acceso aleatorio, que es el
  motivo de que el formato sea un ZIP y no un tar.
- **El servidor tiene que honrar `Range`.** Si responde `200` en vez de `206` está mandando
  el fichero entero: se falla, porque el caller creería bajar 4 KB de índice y estaría
  bajando cientos de megas, y sólo se notaría en la factura.
- **ZIP64 se detecta y se declara.** Todavía no se soporta, y leer un contenedor de más de
  4 GB con los campos de 32 bits daría offsets truncados: entradas apuntando a mitad de
  otro fichero, sin error.

## Estado frente al §11 del spec

Lo implementado es el **§11.1 (pipeline de carga)** y el **primer paso del §11.2**. Lo
demás está por hacer y aquí queda escrito cuál es cuál, para que nadie lo dé por hecho.

| §11 | Estado |
|---|---|
| `UosLoader`: manifiesto, `load_priority`, carga perezosa | **sí** |
| `ZipRangeReader` (HTTP / `File` / disco) | **sí** |
| Verificación `sha256` por asset, a petición | **sí** |
| Grafo de marcos: los que no conectan con el canónico se declaran | **sí** |
| Vistas guardadas (§7): aplicar una a la cámara | **sí** |
| Assets-directorio (serie DICOM): un corte suelto por rango | **sí** |
| Sidecar del volumen (§5.2), sin parser DICOM en el cliente | **se lee** |
| **1. Mesh pass** — geometría opaca, material clínico neutro | **sí** (STL; glTF pendiente) |
| **2. Volume pass** — raycast contra `Texture3D`, presets CBCT, depth-aware | no |
| **3. GS pass** — splats, blending, depth test contra el mesh | no |
| **4. Overlays** — MPR, clip planes, mediciones, anotaciones | no |
| Picking semántico → `extras.uos_fdi` | no |
| MPR sincronizado · timeline dual · deep-links | no |
| `SignalLoader` · `DerivedLoader` | no |
| `raw.zst` del volumen (`fzstd`) | no |

**La limitación que el spec ya reconoce y aquí también:** componer GS translúcido con
volumen translúcido no tiene solución exacta con dos pasadas independientes. Cuando llegue
el paso 3, la política de v1 será GS encima con opacidad global, y en vistas con volumen
activo el GS en modo *shell* con opacidad ≤ 0,5. Documentado, no escondido.

## Tests

Los tests corren contra `.uos` **de verdad**, porque lo único que no prueba un fixture
inventado es que un ZIP escrito por otra herramienta —con sus extras y sus cabeceras— se lea
bien. Los contenedores no se versionan (son datos clínicos), así que los tests **se saltan**
si no están en vez de fallar en el CI de quien clone el repositorio:

```bash
UOS_CORE=/ruta/a/core.uos UOS_VOL=/ruta/a/con-volumen.uos npm test
```

Dos de ellos cuentan los bytes pedidos y exigen que abrir el contenedor y leer un asset
cueste una fracción de su tamaño: es la prueba de que la lectura es de verdad por rangos y
no una descarga disfrazada.

## Y qué NO es

No es `dental-3dgs-viewer`, que enseña el gemelo de un pipeline concreto consumiendo su
sidecar. Éste abre el `.uos` de cualquier emisor y sólo se fía del manifiesto.

Tampoco hace inferencia. Layer 1: lo que se ve es lo que alguien midió, y lo que salga de un
modelo vive en `derived/`, que es desmontable por diseño.

## Licencia

MIT. El formato es un borrador abierto; una implementación de referencia que no se pueda
copiar no sirve de referencia.
