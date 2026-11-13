# UrbexPlay

App web para organizar salidas de urbex: mapa de lugares abandonados y con
leyenda, su historia con fuentes, ficha práctica, diario de visitas y
planificador de salidas. Centrada en la Región de Murcia, con lugares del resto
de España.

## Uso

```bash
npm install
npm run dev      # desarrollo, en http://localhost:5173
npm run build    # compila a dist/
npm run preview  # sirve dist/ (aquí funciona el modo sin conexión)
```

Cada subida a `main` la publica en GitHub Pages
(<https://hersadev.github.io/UrbexPlay/>) mediante
`.github/workflows/publicar.yml`. Desde ahí se puede instalar en el móvil y
usar sin cobertura, con GPS.

## Sobre el terreno

- **Posición en vivo**: el botón ⌖ del mapa sigue tu posición; «Guiarme», en la
  ficha de un lugar, marca la distancia y el rumbo en línea recta hasta él.
- **Mapa sin cobertura**: en cada salida, «Guardar mapa de esta salida» descarga
  el topográfico y el satélite del IGN alrededor de las paradas. El callejero de
  OpenStreetMap no se descarga porque su política de uso no lo permite.

## Añadir lugares

- **Buscar**: al crear un lugar, el buscador consulta Wikipedia y OpenStreetMap
  y rellena nombre, coordenadas, municipio, resumen y fuente. Lo que se escribe
  en el buscador se envía a esos dos servicios.
- **Pegar**: el campo de coordenadas acepta un enlace largo de Google Maps o
  coordenadas en cualquier formato habitual. Los enlaces cortos
  (`maps.app.goo.gl`) no sirven porque no llevan las coordenadas.
- **Importar**: desde la lista de lugares, «Importar» lee ficheros KML, GPX y
  GeoJSON (solo los puntos) o una lista pegada de enlaces y coordenadas. Los KMZ
  no: en Google My Maps hay que exportar como KML.

## Datos

- Todo se guarda en el navegador (IndexedDB). Desde **Ajustes** se exporta e
  importa una copia en JSON, que incluye las fotos.
- Opcionalmente se sincroniza con una hoja de cálculo de Google (ver más abajo).
- El catálogo inicial está en `src/catalog.ts`. La historia y las coordenadas
  salen de los artículos de Wikipedia enlazados en cada ficha; las coordenadas
  marcadas con `approx` son orientativas.
- Las leyendas van en un campo aparte de la historia documentada.
- La ficha práctica (estado, acceso, propiedad) es orientativa y hay que
  confirmarla antes de cada salida.

## Mapas

OpenStreetMap y el Instituto Geográfico Nacional (ortofoto PNOA y mapa
topográfico MTN, CC BY 4.0). Las teselas ya vistas quedan en caché para usarlas
sin cobertura.

## Sincronización con Google Sheets

Sirve para tener los mismos datos en varios dispositivos. La hoja guarda tus
lugares propios (y los del catálogo que hayas editado u ocultado), el diario y
las salidas; el catálogo inicial sigue viviendo en la app y las fotos se quedan
en cada dispositivo.

1. En **Ajustes → Sincronizar con Google Sheets**, elige una clave y pulsa
   «Copiar script» (es `google-apps-script/Code.gs` con tu clave puesta).
2. En la hoja: *Extensiones → Apps Script*, pega el script y guarda.
3. *Implementar → Nueva implementación → Aplicación web*. Ejecutar como: *Yo*.
   Acceso: *Cualquier usuario*.
4. Pega la URL de la aplicación web en Ajustes y pulsa «Conectar». En los demás
   dispositivos basta con este paso.

El script crea las pestañas `Lugares`, `Diario`, `Salidas` y `Ocultos`. Se puede
editar la hoja a mano: una fila nueva en `Lugares` con nombre, `lat` y `lng`
aparece en la app en la siguiente sincronización. Para borrar, escribe `TRUE`
en la columna `borrado` en lugar de eliminar la fila.

Los lugares del catálogo inicial solo están en la hoja si se editan o si se
pulsa «Pasar el catálogo a la hoja» en Ajustes. Una vez allí manda la hoja: los
cambios posteriores del catálogo en el código no modifican esas fichas. Marcar
`borrado` en un lugar del catálogo lo devuelve a su versión original; para que
deje de verse hay que ocultarlo desde la app.

En cada registro gana el último cambio. Quien conozca la URL y la clave puede
leer y escribir los datos: no las publiques. Si cambias el script, hay que
crear una versión nueva de la implementación para que surta efecto.
