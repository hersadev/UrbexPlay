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
npm test         # pruebas (Vitest); también se ejecutan antes de publicar
```

Cada subida a `main` la publica en GitHub Pages
(<https://hersadev.github.io/UrbexPlay/>) mediante
`.github/workflows/publicar.yml`. Desde ahí se puede instalar en el móvil y
usar sin cobertura, con GPS.

## Sobre el terreno

- **Posición en vivo**: el botón ⌖ del mapa sigue tu posición.
- **Guiarme**: desde la ficha de un lugar, te lleva por carretera hasta su punto
  de aparcamiento y, al llegar, a pie hasta la entrada (los dos puntos son
  opcionales y se ponen al editar la ficha; sin ellos se guía al propio lugar).
  «A pie» / «En coche» cambia de etapa a mano. Las rutas a pie las calcula el
  mismo servidor OSRM que las de carretera.
- **Flecha de rumbo**: en un móvil con brújula, la guía enseña una flecha que
  señala el destino según hacia dónde mires; sin brújula, el punto cardinal.
- **Dónde aparqué**: el botón 🚗 del mapa guarda la posición del coche; después
  te guía a pie de vuelta. Se guarda solo en ese dispositivo.
- **Grabar el recorrido**: «Grabar recorrido», en el diario de un lugar, registra
  por dónde te mueves y lo guarda en la visita de ese día, para verlo en el mapa
  o exportarlo en GPX. El navegador solo da la posición con la app abierta y la
  pantalla encendida. Los recorridos, como las fotos, se quedan en el
  dispositivo y van en la copia de seguridad.
- **Mapa sin cobertura**: en cada salida, «Guardar mapa de esta salida» descarga
  el topográfico y el satélite del IGN alrededor de las paradas. El callejero de
  OpenStreetMap no se descarga porque su política de uso no lo permite.

## Salidas

- **Ruta por carretera**: cada salida muestra los kilómetros y el tiempo al
  volante entre paradas y el total, y dibuja el trazado en el mapa. Lo calcula
  el servidor OSRM de FOSSGIS (`routing.openstreetmap.de`), gratuito y sin
  clave, al que se envían las coordenadas del recorrido. Las últimas rutas
  quedan guardadas; sin conexión y sin ruta guardada se enseña la línea recta.
- **Punto de salida**: se busca por nombre, se toma del GPS o se repite el de
  otra salida. Con él, el total cuenta la ida y la vuelta.
- **Luz**: con fecha, cada parada indica amanecer, atardecer y hora dorada (sol
  a menos de 6°). Se calcula en el dispositivo, con horizonte llano.
- **Tiempo previsto**: con fecha a 16 días vista o menos, cada parada enseña la
  previsión de Open-Meteo (cielo, temperaturas, lluvia y viento). Se le envían
  las coordenadas de las paradas, redondeadas a unos 100 m.
- **Mejor orden**: reordena las paradas por la ruta con menos carretera, con el
  servicio de viaje de OSRM; sin conexión, por cercanía en línea recta.
- **Dejar dicho adónde voy**: comparte por WhatsApp o por donde elijas un texto
  con las paradas, sus coordenadas y la hora prevista de vuelta.
- **Equipo**: lista marcable que sale del campo «Equipo recomendado» de las
  paradas, sin repetir lo que piden varias.

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
  importa una copia en ZIP, que incluye las fotos y los recorridos. Las copias
  antiguas en JSON se siguen pudiendo importar.
- Opcionalmente se sincroniza con una hoja de cálculo de Google (ver más abajo).
- El catálogo inicial está en `src/catalog.ts`. La historia y las coordenadas
  salen de los artículos de Wikipedia enlazados en cada ficha; las coordenadas
  marcadas con `approx` son orientativas.
- Las leyendas van en un campo aparte de la historia documentada.
- La ficha práctica (estado, acceso, propiedad) es orientativa y hay que
  confirmarla antes de cada salida. Se enseña como «sin verificar sobre el
  terreno» hasta que alguien le pone fecha de comprobación, con «La he
  comprobado hoy» en la ficha o al editarla; pasado un año, la comprobación se
  marca como antigua. Las fichas del catálogo inicial no llevan fecha.

## Avisos

- Al abrir la app por primera vez hay que aceptar un aviso: que un lugar esté
  en el mapa no significa que se pueda entrar, y en los privados no se entra
  sin permiso. La aceptación se guarda en cada dispositivo.
- Cada ficha abre con sus avisos (propiedad, riesgos, ficha sin verificar,
  coordenadas aproximadas) y «Guiarme» los repite antes de empezar.
- Los textos están en `src/safety.ts`; al subir `NOTICE_VERSION` se vuelve a
  pedir que se acepte el aviso inicial.

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

El script crea las pestañas `Lugares`, `Diario`, `Salidas` y `Ocultos`. El punto
de salida y el equipo marcado de cada salida viajan en las columnas `origen` y
`equipo` de `Salidas`; una hoja con un script anterior a esas columnas sigue
funcionando, pero no los pasa de un dispositivo a otro hasta actualizar el
script. Lo mismo ocurre con las horas de salida y de vuelta (columnas
`hora_salida` y `hora_vuelta` de `Salidas`), con los puntos de aparcamiento y de entrada, en las
columnas `aparcamiento_coords` y `entrada_coords` de `Lugares`, y con la fecha
de comprobación de la ficha, en la columna `comprobado` (`AAAA-MM-DD`). Se puede
editar la hoja a mano: una fila nueva en `Lugares` con nombre, `lat` y `lng`
aparece en la app en la siguiente sincronización. Para borrar, escribe `TRUE`
en la columna `borrado` en lugar de eliminar la fila.

Los lugares del catálogo inicial solo están en la hoja si se editan o si se
pulsa «Pasar el catálogo a la hoja» en Ajustes. Una vez allí manda la hoja: los
cambios posteriores del catálogo en el código no modifican esas fichas. Marcar
`borrado` en un lugar del catálogo lo devuelve a su versión original; para que
deje de verse hay que ocultarlo desde la app.

En cada registro gana el último cambio. El diario es la excepción: si editas el
de un mismo lugar en dos dispositivos sin sincronizar entre medias, las dos
versiones se mezclan visita a visita y se conservan las notas de ambos. Quien conozca la URL y la clave puede
leer y escribir los datos: no las publiques. Si cambias el script, hay que
crear una versión nueva de la implementación para que surta efecto.
