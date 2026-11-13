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

Para probarla en el móvil dentro de la misma wifi: `npm run dev -- --host` y
abre la dirección de red que muestra. La instalación como app y el modo sin
conexión requieren HTTPS, es decir, publicarla (cualquier hosting estático
sirve: basta subir `dist/`).

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

En cada registro gana el último cambio. Quien conozca la URL y la clave puede
leer y escribir los datos: no las publiques. Si cambias el script, hay que
crear una versión nueva de la implementación para que surta efecto.
