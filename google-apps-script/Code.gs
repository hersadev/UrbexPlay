/**
 * UrbexPlay · sincronización con Google Sheets.
 *
 * Se pega en la hoja (Extensiones → Apps Script) y se publica como aplicación
 * web. La app envía sus cambios y recibe el contenido completo de la hoja; en
 * cada fila gana la versión con la marca «actualizado» más reciente.
 *
 * Para borrar algo desde la hoja no elimines la fila: escribe TRUE en la
 * columna «borrado». Si eliminas la fila, la app la volverá a crear.
 */

// La misma clave que escribas en Ajustes de la app. Sin cambiarla, el script no responde.
const CLAVE = 'CAMBIA-ESTA-CLAVE';

const HOJAS = {
  Lugares: [
    'id', 'nombre', 'tipo', 'lat', 'lng', 'aproximadas', 'municipio', 'provincia', 'resumen',
    'historia', 'leyenda', 'fuentes', 'estado', 'acceso', 'propiedad', 'dificultad', 'riesgos',
    'aparcar', 'equipo', 'aparcamiento_coords', 'entrada_coords', 'actualizado', 'borrado',
  ],
  Diario: ['id', 'lugar', 'estado', 'notas', 'visitas', 'actualizado', 'borrado'],
  Salidas: ['id', 'nombre', 'fecha', 'notas', 'paradas', 'origen', 'equipo', 'actualizado', 'borrado'],
  Ocultos: ['id', 'lugar', 'actualizado', 'borrado'],
};

function doGet() {
  return responder({ ok: true, app: 'urbexplay' });
}

function doPost(e) {
  let peticion;
  try {
    peticion = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'Petición no válida.' });
  }
  if (CLAVE === 'CAMBIA-ESTA-CLAVE') {
    return responder({ ok: false, error: 'Falta poner tu clave en el script de la hoja.' });
  }
  if (peticion.clave !== CLAVE) {
    return responder({ ok: false, error: 'La clave no coincide con la del script.' });
  }

  // Un solo dispositivo a la vez, para que dos sincronizaciones no se pisen.
  const cerrojo = LockService.getScriptLock();
  cerrojo.waitLock(25000);
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const cambios = peticion.cambios || {};
    const datos = {};
    Object.keys(HOJAS).forEach(function (nombre) {
      datos[nombre] = sincronizarHoja(libro, nombre, cambios[nombre] || []);
    });
    return responder({ ok: true, datos: datos });
  } finally {
    cerrojo.releaseLock();
  }
}

/** Al editar a mano una fila, renueva su marca para que la app recoja el cambio. */
function onEdit(e) {
  const hoja = e.range.getSheet();
  if (!HOJAS[hoja.getName()] || hoja.getLastColumn() === 0) return;
  const cabeceras = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0];
  const columna = cabeceras.indexOf('actualizado') + 1;
  if (!columna) return;
  if (e.range.getColumn() === columna && e.range.getLastColumn() === columna) return;
  const primera = Math.max(e.range.getRow(), 2);
  const filas = e.range.getLastRow() - primera + 1;
  if (filas < 1) return;
  hoja.getRange(primera, columna, filas, 1).setValue(String(Date.now()));
}

function sincronizarHoja(libro, nombre, cambios) {
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }

  const valores = hoja.getDataRange().getDisplayValues();
  const cabeceras = (valores[0] || []).map(function (c) { return String(c).trim(); });
  let tocado = false;
  HOJAS[nombre].forEach(function (c) {
    if (cabeceras.indexOf(c) < 0) {
      cabeceras.push(c);
      tocado = true;
    }
  });
  const filas = valores.slice(1).map(function (fila) {
    const copia = fila.slice();
    while (copia.length < cabeceras.length) copia.push('');
    return copia;
  });

  const resultado = fusionar(cabeceras, filas, cambios, Date.now(), function () {
    return Utilities.getUuid();
  });

  if (tocado || resultado.cambiado) {
    // Todo como texto: evita que Sheets convierta fechas, coordenadas o ids.
    hoja.getRange(1, 1, hoja.getMaxRows(), Math.max(cabeceras.length, hoja.getMaxColumns())).setNumberFormat('@');
    hoja.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]);
    if (hoja.getLastRow() > 1) {
      hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getMaxColumns()).clearContent();
    }
    if (resultado.filas.length) {
      hoja.getRange(2, 1, resultado.filas.length, cabeceras.length).setValues(resultado.filas.map(protegerFila));
    }
  }

  return resultado.filas.map(function (fila) {
    const objeto = {};
    cabeceras.forEach(function (c, i) { objeto[c] = fila[i]; });
    return objeto;
  });
}

/**
 * Mezcla los cambios de la app con las filas de la hoja. Función pura.
 * - Las filas escritas a mano sin id o sin marca reciben una.
 * - Un cambio de la app solo sustituye la fila si su marca es más reciente.
 */
function fusionar(cabeceras, filas, cambios, ahora, nuevoId) {
  const iId = cabeceras.indexOf('id');
  const iMarca = cabeceras.indexOf('actualizado');
  let cambiado = false;

  const salida = filas.filter(function (fila) {
    const vacia = fila.every(function (celda) { return String(celda).trim() === ''; });
    if (vacia) cambiado = true;
    return !vacia;
  });

  const porId = {};
  salida.forEach(function (fila, i) {
    if (String(fila[iId]).trim() === '') {
      fila[iId] = nuevoId();
      fila[iMarca] = String(ahora);
      cambiado = true;
    } else if (!(Number(fila[iMarca]) > 0)) {
      fila[iMarca] = String(ahora);
      cambiado = true;
    }
    const id = String(fila[iId]).trim();
    if (!(id in porId)) porId[id] = i;
  });

  cambios.forEach(function (cambio) {
    const id = String(cambio.id || '').trim();
    if (!id) return;
    const existe = id in porId;
    if (existe && !(Number(cambio.actualizado) > Number(salida[porId[id]][iMarca]))) return;
    const fila = existe ? salida[porId[id]] : cabeceras.map(function () { return ''; });
    cabeceras.forEach(function (c, i) {
      if (c in cambio) fila[i] = cambio[c] == null ? '' : String(cambio[c]);
    });
    if (!existe) {
      porId[id] = salida.length;
      salida.push(fila);
    }
    cambiado = true;
  });

  return { filas: salida, cambiado: cambiado };
}

/** Un texto que empieza por «=» o «+» se guardaría como fórmula: se fuerza a texto. */
function protegerFila(fila) {
  return fila.map(function (celda) {
    const texto = String(celda);
    return /^[=+]/.test(texto) ? "'" + texto : texto;
  });
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
