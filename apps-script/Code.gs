/**
 * RELEVAMIENTO GRIDO: receptor de datos para Google Sheets
 * =========================================================
 * Este script recibe los registros que envía la app y los agrega como filas
 * en una hoja por tabla (Llegadas, Personas, Tipo, Caja, Individuales, Peso).
 *
 * CÓMO INSTALARLO (una sola vez, lo hace una persona del grupo):
 *   1. Creá una planilla nueva en Google Sheets.
 *   2. Menú Extensiones > Apps Script. Borrá lo que haya y pegá este archivo completo.
 *   3. Cambiá la constante CLAVE (abajo) por una clave propia. Es la que van a usar los celulares.
 *   4. Guardá, elegí la función "configurar" en el desplegable de arriba y tocá Ejecutar.
 *      La primera vez Google pide permisos: aceptalos (es tu propio script).
 *      Esto crea las 6 hojas con sus encabezados.
 *   5. Tocá Implementar > Nueva implementación > tipo "Aplicación web":
 *        - Ejecutar como: Yo
 *        - Quién tiene acceso: Cualquier persona
 *      Copiá la URL que termina en /exec: es el "enlace del script" de la app.
 *   6. En la app: Ajustes > Google Sheets, pegá el enlace y la clave, y tocá "Probar conexión".
 *
 * SI DESPUÉS CAMBIÁS ESTE CÓDIGO: Implementar > Administrar implementaciones > editar (lápiz)
 * > Versión: "Nueva versión" > Implementar. La URL no cambia.
 *
 * SEGURIDAD: el enlace /exec es público, pero solo escribe quien conoce la CLAVE.
 * Compartí el enlace de configuración solo con quienes van a cargar datos.
 */

// ---------- CAMBIAR ESTA CLAVE ----------
const CLAVE = 'CAMBIAR-ESTA-CLAVE';
// ----------------------------------------

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

/**
 * Definición de las hojas. El orden de "columnas" es el orden de las columnas en la planilla.
 * Las primeras son las mismas que exporta la app; al final se agregan:
 *   - id: identificador único del registro (evita duplicados si se reenvía)
 *   - recibido_el: hora en que llegó a la planilla (puede diferir de cargado_el si hubo demora)
 */
const HOJAS = {
  llegadas:     { nombre: 'Llegadas',     columnas: ['hora_llegada', 'intervalo_seg', 'cargado_el', 'observador', 'id', 'recibido_el'] },
  personas:     { nombre: 'Personas',     columnas: ['personas', 'cargado_el', 'observador', 'id', 'recibido_el'] },
  tipo:         { nombre: 'Tipo',         columnas: ['tipo', 'cargado_el', 'observador', 'id', 'recibido_el'] },
  caja:         { nombre: 'Caja',         columnas: ['duracion_seg', 'inicio', 'fin', 'cargado_el', 'observador', 'id', 'recibido_el'] },
  individuales: { nombre: 'Individuales', columnas: ['duracion_seg', 'personas', 'grupo_grande', 'inicio', 'fin', 'cargado_el', 'observador', 'id', 'recibido_el'] },
  peso:         { nombre: 'Peso',         columnas: ['duracion_seg', 'inicio', 'fin', 'cargado_el', 'observador', 'id', 'recibido_el'] }
};

const COLUMNAS_FECHA = ['hora_llegada', 'inicio', 'fin', 'cargado_el', 'recibido_el'];
const COLUMNAS_DECIMAL = ['duracion_seg', 'intervalo_seg'];


/**
 * Ejecutar UNA VEZ a mano desde el editor: crea las hojas con encabezados y formatos.
 * Se puede volver a ejecutar sin problema (no borra datos).
 */
function configurar() {
  const planilla = SpreadsheetApp.getActiveSpreadsheet();
  planilla.setSpreadsheetTimeZone(ZONA_HORARIA);
  Object.keys(HOJAS).forEach(function (clave) { obtenerHoja(planilla, HOJAS[clave]); });

  // Quita la hoja vacía que trae una planilla nueva
  ['Hoja 1', 'Sheet1'].forEach(function (nombre) {
    const sobrante = planilla.getSheetByName(nombre);
    if (sobrante && sobrante.getLastRow() === 0 && planilla.getSheets().length > 1) planilla.deleteSheet(sobrante);
  });
  planilla.toast('Listo: hojas creadas. Ahora implementá la aplicación web.', 'Relevamiento', 8);
}


/** Recibe los registros enviados por la app (POST con JSON en texto plano). */
function doPost(e) {
  const candado = LockService.getScriptLock();
  try {
    candado.waitLock(25000);   // evita que dos envíos simultáneos se pisen
  } catch (err) {
    return respuesta({ ok: false, error: 'Planilla ocupada, reintentar' });
  }

  try {
    const carga = JSON.parse(e.postData.contents);
    if (!carga || carga.clave !== CLAVE) return respuesta({ ok: false, error: 'Clave incorrecta' });
    if (!Array.isArray(carga.filas)) return respuesta({ ok: false, error: 'Faltan las filas' });

    const planilla = SpreadsheetApp.getActiveSpreadsheet();
    const ahora = new Date();

    // Agrupa las filas por tabla
    const porTabla = {};
    carga.filas.forEach(function (fila) {
      if (HOJAS[fila.tabla]) (porTabla[fila.tabla] = porTabla[fila.tabla] || []).push(fila);
    });

    let agregadas = 0;
    let repetidas = 0;
    Object.keys(porTabla).forEach(function (clave) {
      const def = HOJAS[clave];
      const hoja = obtenerHoja(planilla, def);
      const idsExistentes = leerIds(hoja, def);
      const nuevas = [];

      porTabla[clave].forEach(function (fila) {
        const id = String(fila.id);
        if (idsExistentes[id]) { repetidas++; return; }   // ya estaba: se ignora
        idsExistentes[id] = true;
        nuevas.push(def.columnas.map(function (col) { return valorDeCelda(col, fila, ahora); }));
        agregadas++;
      });

      if (nuevas.length) {
        // Si se llenó la hoja (1000 filas por defecto), se le agregan filas antes de escribir
        const necesarias = hoja.getLastRow() + nuevas.length;
        if (necesarias > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), necesarias - hoja.getMaxRows());
        hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, def.columnas.length).setValues(nuevas);
      }
    });

    return respuesta({ ok: true, agregadas: agregadas, repetidas: repetidas });
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  } finally {
    candado.releaseLock();
  }
}


/** Prueba de conexión desde la app: ...?accion=ping&clave=... */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.clave !== CLAVE) return respuesta({ ok: false, error: 'Clave incorrecta' });
  return respuesta({ ok: true, hojas: Object.keys(HOJAS).map(function (k) { return HOJAS[k].nombre; }), hora: new Date().toISOString() });
}


/* ------------------------------ Auxiliares ------------------------------ */

/** Valor que va en una columna para una fila recibida */
function valorDeCelda(columna, fila, ahora) {
  if (columna === 'id') return String(fila.id);
  if (columna === 'recibido_el') return ahora;
  const v = fila.valores ? fila.valores[columna] : null;
  if (v === null || v === undefined) return '';
  if (COLUMNAS_FECHA.indexOf(columna) !== -1) return new Date(v);   // llega como texto ISO
  return v;
}

/** Devuelve la hoja; si no existe la crea con encabezados y formatos */
function obtenerHoja(planilla, def) {
  let hoja = planilla.getSheetByName(def.nombre);
  if (hoja) return hoja;

  hoja = planilla.insertSheet(def.nombre);
  hoja.getRange(1, 1, 1, def.columnas.length).setValues([def.columnas]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  const filas = hoja.getMaxRows();
  def.columnas.forEach(function (col, i) {
    const rango = hoja.getRange(2, i + 1, filas - 1, 1);
    if (COLUMNAS_FECHA.indexOf(col) !== -1) { rango.setNumberFormat('dd/mm/yyyy hh:mm:ss'); hoja.setColumnWidth(i + 1, 150); }
    else if (COLUMNAS_DECIMAL.indexOf(col) !== -1) rango.setNumberFormat('0.0');
    else if (col === 'id') rango.setNumberFormat('@');   // texto: evita que un id como "123e4" se convierta en número
  });
  return hoja;
}

/** Conjunto de los id que ya están en la hoja (para no duplicar) */
function leerIds(hoja, def) {
  const posicion = def.columnas.indexOf('id') + 1;
  const ultima = hoja.getLastRow();
  const ids = {};
  if (ultima < 2) return ids;
  hoja.getRange(2, posicion, ultima - 1, 1).getValues().forEach(function (fila) { ids[String(fila[0])] = true; });
  return ids;
}

function respuesta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
