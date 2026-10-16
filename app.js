'use strict';

/* ==========================================================================
   RELEVAMIENTO GRIDO - app.js
   --------------------------------------------------------------------------
   App para tomar los datos de entrada del modelo de simulación (fila de caja
   y fila de preparación de una heladería).

   Cómo está organizado este archivo (buscá los números):
     1. Constantes y definición de las tablas
     2. Estado y guardado en el celular (localStorage)
     3. Utilidades (formatos, avisos, ventanas modales)
     4. Armado de las tablas (a partir de llegadas y clientes)
     5. Pestaña LLEGADAS
     6. Pestaña ATENCIÓN (fichas con cronómetros)
     7. Pestaña DATOS (exportar, compartir, respaldo)
     8. Sincronización con Google Sheets
     9. Enlace de configuración y código QR
    10. Pestaña AJUSTES
    11. Pantalla encendida, instalación y arranque

   Idea central: cada registro se guarda SIEMPRE primero en el celular. Si la
   sincronización está activada, se envía a Google Sheets cuando hay señal;
   si no hay, queda "pendiente" y se reintenta solo.
   ========================================================================== */


/* ==========================================================================
   1. CONSTANTES Y DEFINICIÓN DE LAS TABLAS
   ========================================================================== */

const VERSION = '1.0.0';
const CLAVE_STORAGE = 'relevamiento-grido-v1';   // nombre bajo el que se guarda todo
const ESPERA_SYNC_MS = 10000;                    // espera antes de enviar (da tiempo a "Deshacer")
const LOTE_SYNC = 25;                            // cantidad de registros por envío
const ANTIREBOTE_LLEGADA_MS = 500;               // ignora toques repetidos muy rápidos
const GRUPO_GRANDE_MIN = 3;                      // "grupo grande" = 3 personas o más (más de 2)
const MAX_PERSONAS = 40;

const NOMBRE_TIPO = { 0: 'Ninguna', 1: 'Individual', 2: 'Por peso' };

/*
  Definición de las tablas. El ORDEN de "columnas" es el orden en que salen
  al copiar, al exportar y en la planilla de Google Sheets.
  (Además, en Sheets cada fila lleva una columna "id" al final, que sirve
  para no duplicar filas si se reenvía un registro.)
*/
const TABLAS = {
  llegadas:     { hoja: 'Llegadas',     titulo: 'Llegadas',                      columnas: ['hora_llegada', 'intervalo_seg', 'cargado_el', 'observador'] },
  personas:     { hoja: 'Personas',     titulo: 'Personas por cliente',          columnas: ['personas', 'cargado_el', 'observador'] },
  tipo:         { hoja: 'Tipo',         titulo: 'Tipo de preparación (0/1/2)',   columnas: ['tipo', 'cargado_el', 'observador'] },
  caja:         { hoja: 'Caja',         titulo: 'Atención del cajero',           columnas: ['duracion_seg', 'inicio', 'fin', 'cargado_el', 'observador'] },
  individuales: { hoja: 'Individuales', titulo: 'Preparación de individuales',   columnas: ['duracion_seg', 'personas', 'grupo_grande', 'inicio', 'fin', 'cargado_el', 'observador'] },
  peso:         { hoja: 'Peso',         titulo: 'Preparación de productos por peso', columnas: ['duracion_seg', 'inicio', 'fin', 'cargado_el', 'observador'] }
};

// Columnas que contienen fecha y hora (se guardan como milisegundos y se formatean al exportar)
const COLUMNAS_FECHA = ['hora_llegada', 'inicio', 'fin', 'cargado_el'];


/* ==========================================================================
   2. ESTADO Y GUARDADO EN EL CELULAR
   ========================================================================== */

function estadoInicial() {
  return {
    version: 1,
    llegadas: [],            // { id, t, inicioSesion, obs, sync }
    clientesActivos: [],     // fichas abiertas: { id, num, personas, tipo, cajaIni, cajaFin, prepIni, prepFin }
    clientes: [],            // clientes terminados: ficha + { terminadoEl, obs, sync }
    contadorClientes: 0,     // numeración de fichas (solo para mostrar)
    proximaEsNuevaSesion: false,
    vista: 'llegadas',
    ultimaSyncOk: null,      // instante (ms) del último envío correcto
    ajustes: {
      observador: '',
      pantallaEncendida: true,
      cortarSesionMin: 15,
      sincronizar: false,
      urlSheets: '',
      claveSheets: ''
    }
  };
}

let almacenamientoOk = true;   // pasa a false si el navegador no deja guardar
let estado = cargarEstado();

/** Lee lo guardado. Si no hay nada (o está dañado), arranca vacío. */
function cargarEstado() {
  const base = estadoInicial();
  try {
    const crudo = localStorage.getItem(CLAVE_STORAGE);
    if (crudo) {
      const guardado = JSON.parse(crudo);
      return Object.assign(base, guardado, { ajustes: Object.assign(base.ajustes, guardado.ajustes || {}) });
    }
  } catch (e) {
    almacenamientoOk = false;
  }
  return base;
}

/** Guarda todo en el celular. Se llama después de cada cambio. */
function guardar() {
  try {
    localStorage.setItem(CLAVE_STORAGE, JSON.stringify(estado));
  } catch (e) {
    if (almacenamientoOk) {
      almacenamientoOk = false;
      aviso('Atención: este navegador no deja guardar datos (¿pestaña privada?). Exportá seguido.');
    }
  }
}


/* ==========================================================================
   3. UTILIDADES
   ========================================================================== */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const pad = n => String(n).padStart(2, '0');

/** dd/mm/aaaa hh:mm:ss en hora local del celular */
function fmtFecha(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${fmtHora(ms)}`;
}
function fmtHora(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Milisegundos a segundos con 1 decimal (la precisión real de un toque es de décimas) */
function segundos(ms) { return Math.round(ms / 100) / 10; }
/** Número con coma decimal (para pegar en Excel configurado en español) */
function fmtNumero(n) { return String(n).replace('.', ','); }
/** Cronómetro: m:ss.d */
function fmtReloj(ms) {
  const dec = Math.max(0, Math.floor(ms / 100));
  return `${Math.floor(dec / 600)}:${pad(Math.floor(dec / 10) % 60)}.${dec % 10}`;
}
function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function vibrar(ms = 25) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* no soportado */ } }
function nombreArchivo(extension) {
  const d = new Date();
  return `relevamiento_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${extension}`;
}

/* ---------- Aviso breve (con acción opcional, ej. "Deshacer") ---------- */
let temporizadorAviso = null;
function aviso(texto, accion) {
  const caja = $('#toast');
  caja.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = texto;
  caja.appendChild(span);
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = accion.texto;
    b.addEventListener('click', () => { caja.hidden = true; accion.fn(); });
    caja.appendChild(b);
  }
  caja.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caja.hidden = true; }, accion ? 7000 : 3800);
}

/* ---------- Ventana modal ---------- */
let resolverModal = null;
let textoModal = '';   // contenido del cuadro de texto del modal (si tiene) al cerrarse

/**
 * Abre una ventana y devuelve una promesa con el "valor" del botón tocado
 * (o null si se cierra tocando afuera).
 * botones: [{ texto, valor, clase }]
 */
function abrirModal({ titulo, html = '', botones, dos = false }) {
  return new Promise(resolve => {
    $('#modal-titulo').textContent = titulo;
    $('#modal-cuerpo').innerHTML = html;
    const cont = $('#modal-botones');
    cont.innerHTML = '';
    cont.classList.toggle('dos', dos);
    botones.forEach(b => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'boton ' + (b.clase || 'secundario');
      el.textContent = b.texto;
      el.addEventListener('click', () => cerrarModal(b.valor));
      cont.appendChild(el);
    });
    resolverModal = resolve;
    $('#toast').hidden = true;   // un aviso anterior no debe tapar el contenido de la ventana
    $('#modal').hidden = false;
  });
}
function cerrarModal(valor) {
  const campo = $('#modal-texto');
  textoModal = campo ? campo.value : '';
  $('#modal').hidden = true;
  const r = resolverModal;
  resolverModal = null;
  if (r) r(valor === undefined ? null : valor);
}
/** Pregunta de sí/no. Devuelve true si se confirma. */
async function preguntar(titulo, html, textoOk, claseOk = 'primario') {
  const r = await abrirModal({
    titulo, html, dos: true,
    botones: [{ texto: 'Volver', valor: false }, { texto: textoOk, valor: true, clase: claseOk }]
  });
  return r === true;
}


/* ==========================================================================
   4. ARMADO DE LAS TABLAS
   Los datos se guardan "crudos" (llegadas y clientes) y las 6 tablas se
   arman a partir de ellos. Así se puede corregir un error antes de exportar
   y las tablas nunca quedan desajustadas entre sí.
   ========================================================================== */

/** Intervalo (en segundos) entre cada llegada y la anterior. Vacío al inicio de una sesión. */
function calcularIntervalos() {
  const orden = [...estado.llegadas].sort((a, b) => a.t - b.t);
  const mapa = new Map();
  let previa = null;
  for (const l of orden) {
    mapa.set(l.id, (previa && !l.inicioSesion) ? segundos(l.t - previa.t) : null);
    previa = l;
  }
  return mapa;
}

/** Filas que genera una llegada: { tabla, valores } */
function filasDeLlegada(l, intervalos) {
  return [{ tabla: 'llegadas', valores: {
    hora_llegada: l.t, intervalo_seg: intervalos.get(l.id), cargado_el: l.t, observador: l.obs || ''
  } }];
}

/** Filas que genera un cliente terminado (según su tipo y los tiempos medidos) */
function filasDeCliente(c) {
  const base = { cargado_el: c.terminadoEl, observador: c.obs || '' };
  const filas = [
    { tabla: 'personas', valores: Object.assign({ personas: c.personas }, base) },
    { tabla: 'tipo',     valores: Object.assign({ tipo: c.tipo }, base) }
  ];
  if (c.cajaIni && c.cajaFin) {
    filas.push({ tabla: 'caja', valores: Object.assign({
      duracion_seg: segundos(c.cajaFin - c.cajaIni), inicio: c.cajaIni, fin: c.cajaFin
    }, base) });
  }
  if (c.tipo !== 0 && c.prepIni && c.prepFin) {
    const tiempos = { duracion_seg: segundos(c.prepFin - c.prepIni), inicio: c.prepIni, fin: c.prepFin };
    if (c.tipo === 1) {
      filas.push({ tabla: 'individuales', valores: Object.assign(tiempos, {
        personas: c.personas, grupo_grande: c.personas >= GRUPO_GRANDE_MIN
      }, base) });
    } else {
      filas.push({ tabla: 'peso', valores: Object.assign(tiempos, base) });
    }
  }
  return filas;
}

/** Devuelve { llegadas: [valores...], personas: [...], ... } ordenado por hora de carga */
function construirTablas() {
  const salida = {};
  Object.keys(TABLAS).forEach(k => { salida[k] = []; });
  const intervalos = calcularIntervalos();
  const items = [
    ...estado.llegadas.map(l => ({ t: l.t, filas: filasDeLlegada(l, intervalos) })),
    ...estado.clientes.map(c => ({ t: c.terminadoEl, filas: filasDeCliente(c) }))
  ].sort((a, b) => a.t - b.t);
  for (const it of items) for (const f of it.filas) salida[f.tabla].push(f.valores);
  return salida;
}

/** Valor de una celda como texto (coma decimal, fechas dd/mm/aaaa hh:mm:ss, TRUE/FALSE) */
function celdaTexto(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (COLUMNAS_FECHA.includes(col)) return fmtFecha(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtNumero(v);
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

/** Texto de una tabla: separado por tabuladores (para pegar en Excel) o por ';' (CSV) */
function tablaATexto(clave, separador, conEncabezados) {
  const def = TABLAS[clave];
  const filas = construirTablas()[clave];
  const lineas = [];
  const protegido = t => (separador === ';' && /[;"\n]/.test(t)) ? '"' + t.replace(/"/g, '""') + '"' : t;
  if (conEncabezados) lineas.push(def.columnas.join(separador));
  for (const v of filas) lineas.push(def.columnas.map(c => protegido(celdaTexto(c, v[c]))).join(separador));
  return lineas.join('\r\n');
}


/* ==========================================================================
   5. PESTAÑA LLEGADAS
   ========================================================================== */

let ultimoToqueLlegada = 0;

function ultimaLlegada() {
  return estado.llegadas.reduce((m, l) => (!m || l.t > m.t ? l : m), null);
}

function registrarLlegada() {
  const ahora = Date.now();
  if (ahora - ultimoToqueLlegada < ANTIREBOTE_LLEGADA_MS) return;   // toque repetido accidental
  ultimoToqueLlegada = ahora;

  const previa = ultimaLlegada();
  const corte = Number(estado.ajustes.cortarSesionMin) || 0;
  let inicioSesion = false;
  if (!previa) {
    inicioSesion = true;
  } else if (estado.proximaEsNuevaSesion) {
    inicioSesion = true;
  } else if (corte > 0 && ahora - previa.t > corte * 60000) {
    inicioSesion = true;
    aviso(`Pasaron más de ${corte} min sin llegadas: se abrió una sesión nueva.`);
  }
  estado.proximaEsNuevaSesion = false;

  estado.llegadas.push({ id: nuevoId(), t: ahora, inicioSesion, obs: estado.ajustes.observador || '', sync: false });
  cambio();
  vibrar();
  const b = $('#btn-llegada');
  b.classList.remove('pulso'); void b.offsetWidth; b.classList.add('pulso');
  syncSoon();
}

function deshacerLlegada() {
  const ultima = ultimaLlegada();
  if (!ultima) { aviso('No hay llegadas para deshacer.'); return; }
  if (ultima.sync) { aviso('Esa llegada ya se envió a Google Sheets: borrala también en la planilla.'); }
  estado.llegadas = estado.llegadas.filter(l => l.id !== ultima.id);
  cambio();
  aviso('Se deshizo la última llegada.');
}

async function nuevaSesion() {
  estado.proximaEsNuevaSesion = !estado.proximaEsNuevaSesion;
  cambio();
  aviso(estado.proximaEsNuevaSesion ? 'Listo: la próxima llegada abre una sesión nueva.' : 'Se canceló la nueva sesión.');
}

function renderLlegadas() {
  const orden = [...estado.llegadas].sort((a, b) => a.t - b.t);
  const intervalos = calcularIntervalos();
  const sesiones = orden.filter(l => l.inicioSesion).length;
  let idxInicio = 0;
  orden.forEach((l, i) => { if (l.inicioSesion) idxInicio = i; });
  const enSesion = orden.length ? orden.length - idxInicio : 0;
  const ultima = orden[orden.length - 1];

  $('#ll-total').textContent = enSesion;
  $('#ll-sesiones').textContent = sesiones;
  $('#ll-ultima').textContent = ultima ? fmtHora(ultima.t) : '-';
  const inter = ultima ? intervalos.get(ultima.id) : null;
  $('#ll-intervalo').textContent = inter === null || inter === undefined ? '-' : fmtNumero(inter) + ' s';
  $('#aviso-sesion').hidden = !estado.proximaEsNuevaSesion;
  $('#btn-nueva-sesion').textContent = estado.proximaEsNuevaSesion ? 'Cancelar nueva sesión' : 'Nueva sesión';

  const ult = orden.slice(-8).reverse();
  $('#lista-llegadas').innerHTML = ult.length
    ? ult.map(l => {
        const iv = intervalos.get(l.id);
        const detalle = l.inicioSesion ? 'inicio de sesión' : (iv === null ? '-' : fmtNumero(iv) + ' s');
        return `<li><span>${fmtHora(l.t)}</span><span>${detalle}</span></li>`;
      }).join('')
    : '<li class="vacio">Todavía no hay llegadas.</li>';
}


/* ==========================================================================
   6. PESTAÑA ATENCIÓN
   Una ficha por cliente, con personas, tipo de preparación y dos cronómetros
   (caja y preparación). Los cronómetros guardan el INSTANTE de inicio y de
   fin (no un contador), así no se desajustan si se bloquea el celular.
   ========================================================================== */

function crearFicha() {
  estado.contadorClientes += 1;
  estado.clientesActivos.push({
    id: nuevoId(), num: estado.contadorClientes,
    personas: 1, tipo: null,                    // tipo: null (sin elegir), 0 ninguna, 1 individual, 2 por peso
    cajaIni: null, cajaFin: null, prepIni: null, prepFin: null
  });
}

/** HTML de una fila de cronómetro. cual: 'caja' o 'prep' */
function htmlReloj(c, cual, etiqueta) {
  const ini = c[cual + 'Ini'], fin = c[cual + 'Fin'];
  const clase = !ini ? '' : (!fin ? 'corriendo' : 'listo');

  // La preparación no aplica si el cliente se lleva solo productos ya elaborados
  if (cual === 'prep' && c.tipo === 0) {
    return `<div class="campo"><span class="etiqueta">${etiqueta}</span><span class="no-aplica">No aplica (se retira después de la caja)</span></div>`;
  }
  const texto = !ini ? '0:00.0' : fmtReloj((fin || Date.now()) - ini);
  const boton = !ini
    ? `<button type="button" class="boton primario" data-accion="reloj" data-reloj="${cual}">Iniciar</button>`
    : (!fin
        ? `<button type="button" class="boton corriendo" data-accion="reloj" data-reloj="${cual}">Detener</button>`
        : `<button type="button" class="boton" disabled>Listo</button>`);
  const reinicio = ini ? `<button type="button" class="boton reinicio" data-accion="reiniciar" data-reloj="${cual}" aria-label="Reiniciar cronómetro">&#8634;</button>` : '';
  return `
    <div class="campo">
      <span class="etiqueta">${etiqueta}</span>
      <div class="reloj-fila">
        <span class="reloj ${clase}" data-ini="${ini || ''}" data-fin="${fin || ''}">${texto}</span>
        <div class="botones-reloj">${boton}${reinicio}</div>
      </div>
    </div>`;
}

function htmlCliente(c) {
  const botonesTipo = [0, 1, 2].map(t =>
    `<button type="button" data-accion="tipo" data-tipo="${t}" class="${c.tipo === t ? 'activo' : ''}">${NOMBRE_TIPO[t]}</button>`
  ).join('');
  return `
    <article class="cliente" data-id="${c.id}">
      <div class="cliente-cab">
        <h3>Cliente ${c.num}</h3>
        <button type="button" class="btn-texto" data-accion="descartar">Descartar</button>
      </div>
      <div class="campo fila-campo">
        <span class="etiqueta">Personas en el grupo</span>
        <div class="stepper">
          <button type="button" data-accion="menos" aria-label="Una persona menos">&minus;</button>
          <output>${c.personas}</output>
          <button type="button" data-accion="mas" aria-label="Una persona más">+</button>
        </div>
      </div>
      <div class="campo">
        <span class="etiqueta">Tipo de preparación (ninguna = solo productos listos)</span>
        <div class="segmentado" data-segmentado>${botonesTipo}</div>
      </div>
      ${htmlReloj(c, 'caja', 'Atención en caja')}
      ${htmlReloj(c, 'prep', 'Preparación')}
      <button type="button" class="boton primario ancho grande terminar" data-accion="terminar">Terminar y guardar</button>
    </article>`;
}

function renderAtencion() {
  $('#lista-clientes').innerHTML = estado.clientesActivos.map(htmlCliente).join('');
}

/** Actualiza en pantalla los cronómetros que están corriendo (10 veces por segundo) */
setInterval(() => {
  $$('.reloj[data-ini]').forEach(el => {
    const ini = Number(el.dataset.ini) || 0;
    const fin = Number(el.dataset.fin) || 0;
    if (ini && !fin) el.textContent = fmtReloj(Date.now() - ini);
  });
}, 100);

/** Toques dentro de las fichas (un solo "escuchador" para todas) */
async function alTocarFicha(ev) {
  const boton = ev.target.closest('[data-accion]');
  if (!boton) return;
  const ficha = boton.closest('.cliente');
  const c = estado.clientesActivos.find(x => x.id === ficha.dataset.id);
  if (!c) return;

  switch (boton.dataset.accion) {
    case 'menos': c.personas = Math.max(1, c.personas - 1); break;
    case 'mas':   c.personas = Math.min(MAX_PERSONAS, c.personas + 1); break;

    case 'tipo': {
      const t = Number(boton.dataset.tipo);
      // Si ya se había cronometrado preparación y ahora se elige "ninguna", se descarta ese tiempo
      if (t === 0 && c.prepIni) {
        const ok = await preguntar('¿Cambiar a "Ninguna"?', '<p>Se va a descartar el tiempo de preparación ya medido para este cliente.</p>', 'Descartar tiempo', 'peligro');
        if (!ok) return;
        c.prepIni = null; c.prepFin = null;
      }
      c.tipo = t;
      break;
    }

    case 'reloj': {
      const ini = boton.dataset.reloj + 'Ini', fin = boton.dataset.reloj + 'Fin';
      if (!c[ini]) c[ini] = Date.now();
      else if (!c[fin]) c[fin] = Date.now();
      vibrar(15);
      break;
    }

    case 'reiniciar': {
      const ok = await preguntar('¿Reiniciar el cronómetro?', '<p>Se borra el tiempo medido y se puede volver a empezar.</p>', 'Reiniciar', 'peligro');
      if (!ok) return;
      c[boton.dataset.reloj + 'Ini'] = null;
      c[boton.dataset.reloj + 'Fin'] = null;
      break;
    }

    case 'descartar': {
      const ok = await preguntar(`¿Descartar el cliente ${c.num}?`, '<p>No se guarda ningún dato de esta ficha.</p>', 'Descartar', 'peligro');
      if (!ok) return;
      estado.clientesActivos = estado.clientesActivos.filter(x => x.id !== c.id);
      break;
    }

    case 'terminar':
      await terminarCliente(c.id, ficha);
      return;
  }
  cambio();
}

/** Termina un cliente: valida, genera los registros y los guarda */
async function terminarCliente(id, fichaEl) {
  const tToque = Date.now();                         // instante en que se tocó "Terminar"
  const c = estado.clientesActivos.find(x => x.id === id);
  if (!c) return;

  if (c.tipo === null) {                             // sin tipo no se puede saber a qué tabla va
    const seg = fichaEl && fichaEl.querySelector('[data-segmentado]');
    if (seg) seg.classList.add('sin-elegir');
    aviso('Elegí el tipo de preparación: ninguna, individual o por peso.');
    return;
  }

  // Advertencias que conviene confirmar antes de guardar
  const adv = [];
  if (c.cajaIni && !c.cajaFin) adv.push('El cronómetro de caja sigue en marcha: se detiene ahora.');
  if (c.prepIni && !c.prepFin) adv.push('El cronómetro de preparación sigue en marcha: se detiene ahora.');
  if (!c.cajaIni) adv.push('No hay tiempo de caja: no se agrega a la tabla de caja.');
  if (c.tipo !== 0 && !c.prepIni) adv.push('No hay tiempo de preparación: no se agrega a la tabla de preparación.');
  if (adv.length) {
    const ok = await preguntar('Revisá antes de guardar', '<ul>' + adv.map(a => `<li>${escapar(a)}</li>`).join('') + '</ul>', 'Guardar igual');
    if (!ok) return;
  }

  const copiaFicha = JSON.parse(JSON.stringify(c));  // para poder deshacer
  if (c.cajaIni && !c.cajaFin) c.cajaFin = tToque;
  if (c.prepIni && !c.prepFin) c.prepFin = tToque;

  const registro = {
    id: c.id, num: c.num, personas: c.personas, tipo: c.tipo,
    cajaIni: c.cajaIni, cajaFin: c.cajaFin,
    prepIni: c.tipo === 0 ? null : c.prepIni, prepFin: c.tipo === 0 ? null : c.prepFin,
    terminadoEl: Date.now(), obs: estado.ajustes.observador || '', sync: false
  };
  estado.clientes.push(registro);
  estado.clientesActivos = estado.clientesActivos.filter(x => x.id !== c.id);
  if (!estado.clientesActivos.length) crearFicha();   // deja lista una ficha nueva para el próximo cliente
  cambio();
  vibrar(40);
  syncSoon();
  aviso(`Cliente ${c.num} guardado.`, { texto: 'Deshacer', fn: () => deshacerCliente(registro.id, copiaFicha) });
}

function deshacerCliente(id, copiaFicha) {
  const reg = estado.clientes.find(x => x.id === id);
  if (!reg) return;
  if (reg.sync) { aviso('Ese cliente ya se envió a Google Sheets: no se puede deshacer desde acá.'); return; }
  estado.clientes = estado.clientes.filter(x => x.id !== id);
  // Si la ficha vacía que se creó automáticamente sigue sin usarse, se quita
  estado.clientesActivos = estado.clientesActivos.filter(f => !(f.personas === 1 && f.tipo === null && !f.cajaIni && !f.prepIni));
  estado.clientesActivos.unshift(copiaFicha);
  cambio();
  aviso('Se recuperó la ficha del cliente.');
}


/* ==========================================================================
   7. PESTAÑA DATOS: conteos, exportar, compartir y respaldo
   ========================================================================== */

function pendientes() {
  return { llegadas: estado.llegadas.filter(x => !x.sync).length, clientes: estado.clientes.filter(x => !x.sync).length };
}

function renderDatos() {
  const tablas = construirTablas();
  const sel = $('#sel-tabla');
  if (!sel.options.length) {
    Object.keys(TABLAS).forEach(k => sel.add(new Option(TABLAS[k].titulo, k)));
  }
  const p = pendientes();
  $('#tabla-conteos').innerHTML = Object.keys(TABLAS).map(k =>
    `<tr><td>${escapar(TABLAS[k].titulo)}</td><td>${tablas[k].length}</td></tr>`
  ).join('') + `<tr><td>Clientes con ficha abierta</td><td>${estado.clientesActivos.length}</td></tr>`;

  $('#resumen-pendientes').textContent = estado.ajustes.sincronizar
    ? `Sin enviar a Google Sheets: ${p.llegadas} llegadas y ${p.clientes} clientes.`
    : 'La sincronización está desactivada: los datos quedan solo en este celular. Exportalos o activá Google Sheets en Ajustes.';

  // Últimos registros (llegadas y clientes mezclados, los más nuevos arriba)
  const items = [
    ...estado.llegadas.map(l => ({ clase: 'llegada', id: l.id, t: l.t, sync: l.sync,
      titulo: `Llegada ${fmtHora(l.t)}`, sub: '' })),
    ...estado.clientes.map(c => {
      const caja = c.cajaIni && c.cajaFin ? `caja ${fmtNumero(segundos(c.cajaFin - c.cajaIni))} s` : 'sin tiempo de caja';
      const prep = c.tipo !== 0 && c.prepIni && c.prepFin ? `, prep. ${fmtNumero(segundos(c.prepFin - c.prepIni))} s` : '';
      return { clase: 'cliente', id: c.id, t: c.terminadoEl, sync: c.sync,
        titulo: `Cliente ${c.num}: ${c.personas} pers., ${NOMBRE_TIPO[c.tipo].toLowerCase()}`, sub: `${fmtHora(c.terminadoEl)} - ${caja}${prep}` };
    })
  ].sort((a, b) => b.t - a.t).slice(0, 25);

  $('#lista-registros').innerHTML = items.length ? items.map(it => `
    <li>
      <div class="texto">
        <div>${escapar(it.titulo)}<span class="estado ${it.sync ? 'ok' : 'pend'}">${it.sync ? 'enviado' : (estado.ajustes.sincronizar ? 'pendiente' : '')}</span></div>
        ${it.sub ? `<div class="sub">${escapar(it.sub)}</div>` : ''}
      </div>
      <button type="button" class="btn-texto" data-borrar="${it.clase}" data-id="${it.id}">Borrar</button>
    </li>`).join('') : '<li class="sub">Todavía no hay registros.</li>';
}

async function borrarRegistro(clase, id) {
  const lista = clase === 'llegada' ? estado.llegadas : estado.clientes;
  const it = lista.find(x => x.id === id);
  if (!it) return;
  const extra = it.sync ? '<p>Este registro ya se envió a Google Sheets: la fila queda en la planilla y hay que borrarla ahí a mano.</p>' : '';
  const ok = await preguntar('¿Borrar este registro?', `<p>Se borra de este celular.</p>${extra}`, 'Borrar', 'peligro');
  if (!ok) return;
  if (clase === 'llegada') estado.llegadas = estado.llegadas.filter(x => x.id !== id);
  else estado.clientes = estado.clientes.filter(x => x.id !== id);
  cambio();
}

/* ---------- Copiar al portapapeles ---------- */
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (e) {
    // Plan B para navegadores sin permiso de portapapeles
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

async function copiarTabla() {
  const clave = $('#sel-tabla').value;
  const texto = tablaATexto(clave, '\t', $('#chk-encabezados').checked);
  const filas = construirTablas()[clave].length;
  if (!filas) { aviso('Esa tabla todavía no tiene registros.'); return; }
  if (await copiarTexto(texto)) aviso(`Copiadas ${filas} filas. Pegalas en Excel o Sheets.`);
  else aviso('No se pudo copiar. Probá con "Descargar CSV".');
}

/* ---------- Descargar y compartir archivos ---------- */
function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Abre el menú de compartir del celular (WhatsApp, mail, etc.). Si no existe, descarga. */
async function compartirArchivo(blob, nombre) {
  const archivo = new File([blob], nombre, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;      // la persona canceló
    }
  }
  descargar(blob, nombre);
  aviso('Este navegador no puede compartir archivos: se descargó en su lugar.');
}

function descargarCSV() {
  const clave = $('#sel-tabla').value;
  if (!construirTablas()[clave].length) { aviso('Esa tabla todavía no tiene registros.'); return; }
  // BOM para que Excel respete los acentos; separador ';' porque Excel en español lo espera
  const texto = '﻿' + tablaATexto(clave, ';', true);
  descargar(new Blob([texto], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv').replace('relevamiento_', `relevamiento_${clave}_`));
}

/* ---------- Excel (.xlsx) ---------- */
const promesasScript = {};
/** Carga una librería local solo cuando hace falta (así la app arranca liviana) */
function cargarScript(src) {
  if (!promesasScript[src]) {
    promesasScript[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete promesasScript[src]; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  return promesasScript[src];
}

/** Letra de columna de Excel: 0 -> A, 1 -> B ... */
function letraColumna(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function xml(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Fecha como número de Excel, en hora local (días desde 1900, con fracción) */
function serialExcel(ms) {
  const redondeado = Math.round(ms / 1000) * 1000;
  const local = redondeado - new Date(redondeado).getTimezoneOffset() * 60000;
  return (local / 86400000 + 25569).toFixed(8);
}

/** Genera una hoja de Excel (XML) a partir de una tabla */
function xmlHoja(clave, filas) {
  const def = TABLAS[clave];
  const anchos = def.columnas.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${COLUMNAS_FECHA.includes(c) ? 20 : Math.max(13, c.length + 3)}" customWidth="1"/>`).join('');
  let datos = `<row r="1">${def.columnas.map((c, i) => `<c r="${letraColumna(i)}1" s="3" t="inlineStr"><is><t>${xml(c)}</t></is></c>`).join('')}</row>`;
  filas.forEach((v, r) => {
    const celdas = def.columnas.map((col, i) => {
      const x = v[col];
      if (x === null || x === undefined || x === '') return '';
      const ref = letraColumna(i) + (r + 2);
      if (COLUMNAS_FECHA.includes(col)) return `<c r="${ref}" s="1"><v>${serialExcel(x)}</v></c>`;
      if (typeof x === 'boolean') return `<c r="${ref}" t="b"><v>${x ? 1 : 0}</v></c>`;
      if (typeof x === 'number') return `<c r="${ref}" s="${Number.isInteger(x) ? 0 : 2}"><v>${x}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xml(x)}</t></is></c>`;
    }).join('');
    datos += `<row r="${r + 2}">${celdas}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${anchos}</cols><sheetData>${datos}</sheetData></worksheet>`;
}

/** Arma el archivo .xlsx completo (una solapa por tabla) usando JSZip */
async function construirXLSX() {
  await cargarScript('lib/jszip.min.js');
  const tablas = construirTablas();
  const claves = Object.keys(TABLAS);
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${claves.map((k, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${claves.map((k, i) => `<sheet name="${xml(TABLAS[k].hoja)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`);

  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${claves.map((k, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${claves.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // Estilos: 0 normal, 1 fecha y hora, 2 número con un decimal, 3 encabezado en negrita
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm:ss"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`);

  claves.forEach((k, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, xmlHoja(k, tablas[k])));
  return zip.generateAsync({
    type: 'blob', compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

async function exportarExcel(compartir) {
  if (!estado.llegadas.length && !estado.clientes.length) { aviso('Todavía no hay registros para exportar.'); return; }
  try {
    aviso('Generando el Excel...');
    const blob = await construirXLSX();
    if (compartir) await compartirArchivo(blob, nombreArchivo('xlsx'));
    else { descargar(blob, nombreArchivo('xlsx')); aviso('Excel descargado.'); }
  } catch (e) {
    aviso('No se pudo generar el Excel. Probá con "Copiar tabla" o con el CSV.');
  }
}

/* ---------- Respaldo (.json) ---------- */
function armarRespaldo() {
  // Nunca incluye el enlace ni la clave de Sheets: el respaldo se puede mandar por WhatsApp
  return JSON.stringify({
    app: 'relevamiento-grido', formato: 1, exportadoEl: new Date().toISOString(),
    llegadas: estado.llegadas, clientes: estado.clientes,
    clientesActivos: estado.clientesActivos, contadorClientes: estado.contadorClientes
  }, null, 1);
}

async function restaurarRespaldo(archivo) {
  try {
    const dato = JSON.parse(await archivo.text());
    if (dato.app !== 'relevamiento-grido' || !Array.isArray(dato.llegadas) || !Array.isArray(dato.clientes)) throw new Error('formato');
    const idsLl = new Set(estado.llegadas.map(x => x.id));
    const idsCl = new Set(estado.clientes.map(x => x.id));
    let nuevasLl = 0, nuevosCl = 0;
    dato.llegadas.forEach(l => { if (!idsLl.has(l.id)) { estado.llegadas.push(Object.assign({}, l, { sync: false })); nuevasLl++; } });
    dato.clientes.forEach(c => { if (!idsCl.has(c.id)) { estado.clientes.push(Object.assign({}, c, { sync: false })); nuevosCl++; } });
    estado.contadorClientes = Math.max(estado.contadorClientes, Number(dato.contadorClientes) || 0);
    cambio();
    syncSoon();
    aviso(`Restaurado: ${nuevasLl} llegadas y ${nuevosCl} clientes nuevos.`);
  } catch (e) {
    aviso('Ese archivo no es un respaldo válido de esta app.');
  }
}

async function borrarDatos() {
  const p = pendientes();
  const sinEnviar = p.llegadas + p.clientes;
  const advertencia = estado.ajustes.sincronizar
    ? (sinEnviar ? `<p><strong>Hay ${sinEnviar} registros sin enviar a Google Sheets.</strong> Si los borrás se pierden.</p>` : '<p>Todo lo cargado ya está en Google Sheets.</p>')
    : '<p><strong>La sincronización está desactivada:</strong> si borrás todo y no exportaste, se pierde.</p>';
  const r = await abrirModal({
    titulo: 'Borrar datos de este celular',
    html: advertencia + '<p>Los datos ya enviados a Google Sheets no se tocan.</p>',
    botones: [
      { texto: 'Borrar solo lo ya enviado', valor: 'enviados', clase: 'secundario' },
      { texto: 'Borrar todo', valor: 'todo', clase: 'peligro' },
      { texto: 'Cancelar', valor: null, clase: 'secundario' }
    ]
  });
  if (r === 'enviados') {
    estado.llegadas = estado.llegadas.filter(x => !x.sync);
    estado.clientes = estado.clientes.filter(x => !x.sync);
  } else if (r === 'todo') {
    estado.llegadas = []; estado.clientes = []; estado.clientesActivos = [];
    estado.contadorClientes = 0; estado.proximaEsNuevaSesion = false;
  } else return;
  cambio();
  aviso('Datos borrados.');
}


/* ==========================================================================
   8. SINCRONIZACIÓN CON GOOGLE SHEETS
   Cada envío es un POST de texto plano (JSON) al script de Google. El script
   ignora los "id" que ya tiene, así que reenviar nunca duplica filas.
   ========================================================================== */

let sincronizando = false;
let ultimoErrorSync = null;
let temporizadorSync = null;

/** Programa un envío en unos segundos (agrupa varios cambios seguidos) */
function syncSoon() {
  if (!estado.ajustes.sincronizar || temporizadorSync) return;
  temporizadorSync = setTimeout(() => { temporizadorSync = null; sincronizar(false); }, ESPERA_SYNC_MS);
}

/** Pasa los valores a algo que viaja bien por JSON: fechas en ISO, vacíos como null */
function valoresParaEnvio(v) {
  const o = {};
  Object.keys(v).forEach(k => {
    const x = v[k];
    if (x === null || x === undefined || x === '') o[k] = null;
    else if (COLUMNAS_FECHA.includes(k)) o[k] = new Date(x).toISOString();
    else o[k] = x;
  });
  return o;
}

async function enviarAlScript(carga) {
  const ctl = new AbortController();
  const corte = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(estado.ajustes.urlSheets, {
      method: 'POST',
      // text/plain evita la consulta previa (CORS preflight) que Apps Script no soporta
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(carga),
      signal: ctl.signal
    });
    const texto = await r.text();
    try { return JSON.parse(texto); } catch (e) { throw new Error('el enlace no responde como el script (¿es la URL /exec?)'); }
  } finally {
    clearTimeout(corte);
  }
}

async function sincronizar(manual) {
  const a = estado.ajustes;
  if (!a.sincronizar) { if (manual) aviso('La sincronización está desactivada en Ajustes.'); return; }
  if (!a.urlSheets || !a.claveSheets) { if (manual) aviso('Falta cargar el enlace y la clave en Ajustes.'); return; }
  if (sincronizando) return;

  sincronizando = true;
  actualizarChip();
  try {
    const intervalos = calcularIntervalos();
    const pend = [
      ...estado.llegadas.filter(x => !x.sync).map(x => ({ ref: x, filas: filasDeLlegada(x, intervalos) })),
      ...estado.clientes.filter(x => !x.sync).map(x => ({ ref: x, filas: filasDeCliente(x) }))
    ];
    for (let i = 0; i < pend.length; i += LOTE_SYNC) {
      const lote = pend.slice(i, i + LOTE_SYNC);
      const filas = [];
      lote.forEach(it => it.filas.forEach(f => filas.push({ tabla: f.tabla, id: it.ref.id, valores: valoresParaEnvio(f.valores) })));
      const resp = await enviarAlScript({ clave: a.claveSheets, filas });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'respuesta inválida');
      lote.forEach(it => { it.ref.sync = true; });
      estado.ultimaSyncOk = Date.now();
      guardar();
    }
    ultimoErrorSync = null;
    if (manual) aviso(pend.length ? `Enviados ${pend.length} registros.` : 'Todo estaba al día.');
  } catch (e) {
    ultimoErrorSync = e.name === 'AbortError' ? 'tardó demasiado en responder' : (e.message === 'Failed to fetch' ? 'sin conexión' : e.message);
    if (manual) aviso('No se pudo sincronizar: ' + ultimoErrorSync);
  } finally {
    sincronizando = false;
    // Solo se redibuja lo relacionado con el envío: así no se pisa una ficha de atención mientras se la toca
    renderDatos();
    renderEstadoSync();
    actualizarChip();
  }
}

async function probarConexion() {
  const a = estado.ajustes;
  if (!a.urlSheets || !a.claveSheets) { aviso('Cargá primero el enlace y la clave.'); return; }
  try {
    const url = a.urlSheets + (a.urlSheets.includes('?') ? '&' : '?') + 'accion=ping&clave=' + encodeURIComponent(a.claveSheets);
    const r = await fetch(url);
    const dato = JSON.parse(await r.text());
    aviso(dato.ok ? 'Conexión correcta con la planilla.' : 'El script respondió: ' + (dato.error || 'error'));
  } catch (e) {
    aviso('No se pudo conectar. Revisá el enlace y la señal.');
  }
}

/** Resumen del estado de la sincronización en la esquina superior */
function actualizarChip() {
  const chip = $('#chip-sync');
  const p = pendientes();
  const n = p.llegadas + p.clientes;
  chip.className = 'chip';
  if (!estado.ajustes.sincronizar) {
    chip.textContent = 'Solo local';
  } else if (sincronizando) {
    chip.textContent = 'Enviando...';
    chip.classList.add('pendiente');
  } else if (ultimoErrorSync && n) {
    chip.textContent = `${n} sin enviar`;
    chip.classList.add('error');
  } else if (n) {
    chip.textContent = `${n} sin enviar`;
    chip.classList.add('pendiente');
  } else {
    chip.textContent = 'Al día';
    chip.classList.add('ok');
  }
}


/* ==========================================================================
   9. ENLACE DE CONFIGURACIÓN Y CÓDIGO QR
   Un solo enlace (o QR) lleva el enlace del script y la clave a otros
   celulares, así nadie tiene que escribirlos. Va en la parte "#" del enlace,
   que nunca se envía a ningún servidor.
   ========================================================================== */

function aBase64Url(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deBase64Url(b64) {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function codigoConfig() {
  return aBase64Url(JSON.stringify({ u: estado.ajustes.urlSheets, k: estado.ajustes.claveSheets }));
}
function enlaceConfig() {
  return location.origin + location.pathname + '#cfg=' + codigoConfig();
}

/** Acepta el enlace completo o solo el código, y devuelve { u, k } */
function leerConfig(texto) {
  const m = String(texto).trim().match(/cfg=([A-Za-z0-9_-]+)/);
  const codigo = m ? m[1] : String(texto).trim();
  const obj = JSON.parse(deBase64Url(codigo));
  if (!obj || typeof obj.u !== 'string' || typeof obj.k !== 'string' || !/^https:\/\//.test(obj.u)) throw new Error('config inválida');
  return obj;
}

function aplicarConfig(obj) {
  estado.ajustes.urlSheets = obj.u;
  estado.ajustes.claveSheets = obj.k;
  estado.ajustes.sincronizar = true;
  cambio();
  renderAjustes();
  syncSoon();
  aviso('Configuración de Google Sheets cargada.');
}

/** Si la app se abrió con un enlace de configuración, lo aplica y limpia la barra de direcciones */
function aplicarConfigDesdeHash() {
  if (!location.hash.startsWith('#cfg=')) return;
  try {
    aplicarConfig(leerConfig(location.hash));
  } catch (e) {
    aviso('El enlace de configuración no es válido.');
  }
  history.replaceState(null, '', location.pathname + location.search);
}

/** Dibuja un código QR como SVG (devuelve null si el texto es demasiado largo) */
function qrComoSvg(texto) {
  const { QRCode, QRErrorCorrectLevel } = window.QRCodeLib;
  let qr = null;
  for (let version = 1; version <= 40 && !qr; version++) {
    try {
      const intento = new QRCode(version, QRErrorCorrectLevel.M);
      intento.addData(texto);
      intento.make();
      qr = intento;
    } catch (e) { qr = null; }
  }
  if (!qr) return null;
  const n = qr.getModuleCount(), borde = 2;
  let trazo = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) trazo += `M${c + borde},${r + borde}h1v1h-1z`;
  const lado = n + borde * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${trazo}" fill="#000"/></svg>`;
}

async function compartirConfiguracion() {
  const a = estado.ajustes;
  if (!a.urlSheets || !a.claveSheets) { aviso('Cargá primero el enlace del script y la clave.'); return; }
  await cargarScript('lib/qrcode.js');
  const enlace = enlaceConfig();
  const svg = qrComoSvg(enlace);
  const r = await abrirModal({
    titulo: 'Compartir configuración',
    html: `<p>Mandalo solo a quienes van a cargar datos: quien lo tenga puede escribir en la planilla.</p>
           ${svg ? `<div class="qr">${svg}</div>` : ''}
           <div class="codigo">${escapar(enlace)}</div>
           <p class="nota">En iPhone, si ya instalaste la app, abrí Ajustes y usá "Pegar configuración" con este enlace.</p>`,
    botones: [
      { texto: 'Copiar enlace', valor: 'copiar', clase: 'primario' },
      { texto: 'Compartir enlace', valor: 'compartir' },
      { texto: 'Cerrar', valor: null }
    ]
  });
  if (r === 'copiar') aviso(await copiarTexto(enlace) ? 'Enlace copiado.' : 'No se pudo copiar el enlace.');
  if (r === 'compartir') {
    try { await navigator.share({ title: 'Configuración del relevamiento', url: enlace }); }
    catch (e) { if (!e || e.name !== 'AbortError') aviso(await copiarTexto(enlace) ? 'No se pudo abrir el menú: el enlace quedó copiado.' : 'No se pudo compartir.'); }
  }
}

async function pegarConfiguracion() {
  const r = await abrirModal({
    titulo: 'Pegar configuración',
    html: '<p>Pegá el enlace de configuración (o solo su código):</p><textarea id="modal-texto" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>',
    dos: true,
    botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Aplicar', valor: true, clase: 'primario' }]
  });
  if (r !== true) return;
  try { aplicarConfig(leerConfig(textoModal)); }
  catch (e) { aviso('No se reconoció la configuración. Revisá que esté completa.'); }
}


/* ==========================================================================
   10. PESTAÑA AJUSTES
   ========================================================================== */

/** Carga los valores guardados en los campos de Ajustes */
function renderAjustes() {
  const a = estado.ajustes;
  $('#aj-observador').value = a.observador;
  $('#aj-pantalla').checked = a.pantallaEncendida;
  $('#aj-corte').value = a.cortarSesionMin;
  $('#aj-sync').checked = a.sincronizar;
  $('#aj-url').value = a.urlSheets;
  $('#aj-clave').value = a.claveSheets;
  $('#version-app').textContent = 'Versión ' + VERSION;
  renderEstadoSync();
}

function renderEstadoSync() {
  const a = estado.ajustes;
  const p = pendientes();
  let t;
  if (!a.sincronizar) t = 'Sincronización desactivada: los datos quedan solo en este celular.';
  else {
    t = `Sin enviar: ${p.llegadas} llegadas y ${p.clientes} clientes.`;
    if (estado.ultimaSyncOk) t += ` Último envío correcto: ${fmtFecha(estado.ultimaSyncOk)}.`;
    if (ultimoErrorSync) t += ` Último error: ${ultimoErrorSync}.`;
  }
  $('#estado-sync').textContent = t;
}

function conectarAjustes() {
  const a = estado.ajustes;
  $('#aj-observador').addEventListener('change', e => { a.observador = e.target.value.trim(); guardar(); });
  $('#aj-pantalla').addEventListener('change', e => { a.pantallaEncendida = e.target.checked; guardar(); aplicarPantalla(); });
  $('#aj-corte').addEventListener('change', e => {
    const n = Math.max(0, Math.min(240, parseInt(e.target.value, 10) || 0));
    a.cortarSesionMin = n; e.target.value = n; guardar();
  });
  $('#aj-sync').addEventListener('change', e => { a.sincronizar = e.target.checked; cambio(); syncSoon(); });
  $('#aj-url').addEventListener('change', e => { a.urlSheets = e.target.value.trim(); cambio(); syncSoon(); });
  $('#aj-clave').addEventListener('change', e => { a.claveSheets = e.target.value.trim(); cambio(); syncSoon(); });
  $('#btn-probar').addEventListener('click', probarConexion);
  $('#btn-sync-ahora').addEventListener('click', () => sincronizar(true));
  $('#btn-compartir-config').addEventListener('click', compartirConfiguracion);
  $('#btn-pegar-config').addEventListener('click', pegarConfiguracion);
  $('#btn-borrar').addEventListener('click', borrarDatos);
}


/* ==========================================================================
   11. PANTALLA ENCENDIDA, INSTALACIÓN Y ARRANQUE
   ========================================================================== */

/* ---------- Mantener la pantalla encendida durante las mediciones ---------- */
let candadoPantalla = null;
async function aplicarPantalla() {
  if (!estado.ajustes.pantallaEncendida) {
    if (candadoPantalla) { try { await candadoPantalla.release(); } catch (e) { /* nada */ } candadoPantalla = null; }
    return;
  }
  if (candadoPantalla || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    candadoPantalla = await navigator.wakeLock.request('screen');
    candadoPantalla.addEventListener('release', () => { candadoPantalla = null; });
  } catch (e) { /* el navegador puede negarlo (ahorro de batería): no pasa nada */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') aplicarPantalla(); });
document.addEventListener('pointerdown', () => { if (!candadoPantalla) aplicarPantalla(); }, { passive: true });

/* ---------- Botón "Instalar" (Android) ---------- */
let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', ev => {
  ev.preventDefault();
  eventoInstalar = ev;
  $('#btn-instalar').hidden = false;
});
window.addEventListener('appinstalled', () => { $('#btn-instalar').hidden = true; });

/* ---------- Navegación entre pestañas ---------- */
function irA(nombre) {
  estado.vista = nombre;
  $$('.vista').forEach(v => { v.hidden = v.dataset.vista !== nombre; });
  $$('.navegacion button').forEach(b => {
    if (b.dataset.ir === nombre) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (nombre === 'atencion' && !estado.clientesActivos.length) crearFicha();   // deja una ficha lista para empezar
  if (nombre === 'ajustes') renderAjustes();
  guardar();
  renderTodo();
  window.scrollTo(0, 0);
}

/* ---------- Dibujar todo ---------- */
function renderTodo() {
  renderLlegadas();
  renderAtencion();
  renderDatos();
  renderEstadoSync();
  actualizarChip();
}

/** Después de cualquier cambio de datos: guardar y redibujar */
function cambio() {
  guardar();
  renderTodo();
}

/* ---------- Arranque ---------- */
function iniciar() {
  // Eventos de la pestaña Llegadas
  $('#btn-llegada').addEventListener('click', registrarLlegada);
  $('#btn-deshacer-llegada').addEventListener('click', deshacerLlegada);
  $('#btn-nueva-sesion').addEventListener('click', nuevaSesion);

  // Eventos de la pestaña Atención
  $('#btn-nuevo-cliente').addEventListener('click', () => { crearFicha(); cambio(); });
  $('#lista-clientes').addEventListener('click', alTocarFicha);

  // Eventos de la pestaña Datos
  $('#btn-copiar').addEventListener('click', copiarTabla);
  $('#btn-csv').addEventListener('click', descargarCSV);
  $('#btn-xlsx').addEventListener('click', () => exportarExcel(false));
  $('#btn-compartir-xlsx').addEventListener('click', () => exportarExcel(true));
  $('#btn-respaldo').addEventListener('click', () => descargar(new Blob([armarRespaldo()], { type: 'application/json' }), nombreArchivo('json')));
  $('#btn-compartir-respaldo').addEventListener('click', () => compartirArchivo(new Blob([armarRespaldo()], { type: 'application/json' }), nombreArchivo('json')));
  $('#btn-restaurar').addEventListener('click', () => $('#archivo-respaldo').click());
  $('#archivo-respaldo').addEventListener('change', e => { if (e.target.files[0]) restaurarRespaldo(e.target.files[0]); e.target.value = ''; });
  $('#lista-registros').addEventListener('click', e => {
    const b = e.target.closest('[data-borrar]');
    if (b) borrarRegistro(b.dataset.borrar, b.dataset.id);
  });

  // Navegación, estado de sincronización, modal
  $$('.navegacion button').forEach(b => b.addEventListener('click', () => irA(b.dataset.ir)));
  $('#chip-sync').addEventListener('click', () => { if (estado.ajustes.sincronizar) sincronizar(true); else irA('ajustes'); });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') cerrarModal(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) cerrarModal(null); });
  $('#btn-instalar').addEventListener('click', async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    $('#btn-instalar').hidden = true;
  });
  conectarAjustes();

  // Si la persona vino por un enlace de configuración, se aplica ahora
  aplicarConfigDesdeHash();
  window.addEventListener('hashchange', aplicarConfigDesdeHash);

  // Pide al navegador que no borre los datos por falta de espacio
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }

  // Uso sin señal: el service worker guarda la app en el celular
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker la app igual funciona con señal */ });
  }

  // Reintentos automáticos de envío
  window.addEventListener('online', () => sincronizar(false));
  setInterval(() => {
    const p = pendientes();
    if (estado.ajustes.sincronizar && (p.llegadas + p.clientes) && navigator.onLine) sincronizar(false);
  }, 30000);

  irA(estado.vista in { llegadas: 1, atencion: 1, datos: 1, ajustes: 1 } ? estado.vista : 'llegadas');
  aplicarPantalla();
  sincronizar(false);
  if (!almacenamientoOk) aviso('Atención: este navegador no deja guardar datos (¿pestaña privada?). Exportá seguido.');
}

// Interfaz mínima para poder probar la app desde afuera (no la usa la app)
window.__relevamiento = { estado: () => estado, construirTablas, tablaATexto, qrComoSvg, leerConfig, codigoConfig };

iniciar();
