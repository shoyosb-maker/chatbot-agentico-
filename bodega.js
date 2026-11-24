/* =========================================================
   BODEGA Y AGENDA (compartido por catálogo, chat y panel admin)
   Requiere catalogo.js cargado antes (usa CATALOGO / catalogById).
========================================================= */

const STOCK_KEY = 'motobot_stock';            // { id: cantidad }
const STOCK_MIN_KEY = 'motobot_stock_min';    // { id: minimo }
const AGENDA_KEY = 'motobot_agenda';          // [{ id, cliente, telefono, servicio, fecha, hora, notas, estado }]

/* Stock inicial de la bodega. Los servicios no llevan stock (null). */
const STOCK_INICIAL = {
  'aceite-10w40': 24,
  'filtro-aceite': 12,
  'bujia-ngk': 30,
  'kit-arrastre': 4,
  'pastillas-freno': 6,
  'liquido-frenos': 9,
  'filtro-aire': 8,
  'llanta-delantera': 3,
  'llanta-trasera': 2,
  'bateria': 5,
  'bombillo-led': 7,
  'espejos': 10,
  'moto-cb190r': 2,
  'moto-xr150l': 1,
  'moto-nkd125': 0,
  'moto-ns200': 3
};

/* Mínimo para avisar "stock bajo" */
const MINIMO_INICIAL = {
  'aceite-10w40': 6,
  'filtro-aceite': 4,
  'bujia-ngk': 8,
  'kit-arrastre': 2,
  'pastillas-freno': 3,
  'liquido-frenos': 3,
  'filtro-aire': 3,
  'llanta-delantera': 2,
  'llanta-trasera': 2,
  'bateria': 2,
  'bombillo-led': 2,
  'espejos': 3,
  'moto-cb190r': 1,
  'moto-xr150l': 1,
  'moto-nkd125': 1,
  'moto-ns200': 1
};

function readJson(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const val = JSON.parse(raw);
    return val && typeof val === 'object' ? val : fallback;
  } catch (e){ return fallback; }
}

function writeJson(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e){}
}

/* ---------------- STOCK ---------------- */

let _stockCache = null;
let _minCache = null;

/** Stock guardado, completado con los valores iniciales */
function loadStock(){
  if (_stockCache) return _stockCache;
  _stockCache = { ...STOCK_INICIAL, ...readJson(STOCK_KEY, {}) };
  return _stockCache;
}

function loadMinimos(){
  if (_minCache) return _minCache;
  _minCache = { ...MINIMO_INICIAL, ...readJson(STOCK_MIN_KEY, {}) };
  return _minCache;
}

function saveStockMap(map){ _stockCache = map; writeJson(STOCK_KEY, map); }
function saveMinimosMap(map){ _minCache = map; writeJson(STOCK_MIN_KEY, map); }

/** ¿El artículo maneja stock? (los servicios se prestan, no se almacenan) */
function tracksStock(itemOrId){
  const item = typeof itemOrId === 'string' ? catalogById(itemOrId) : itemOrId;
  if (!item) return false;
  return item.cat !== 'Servicio';
}

function stockOf(id){
  if (!tracksStock(id)) return null;
  const n = Number(loadStock()[id]);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function minimoOf(id){
  const n = Number(loadMinimos()[id]);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** 'na' (servicio) · 'agotado' · 'bajo' · 'disponible' */
function stockStatus(id){
  const stock = stockOf(id);
  if (stock === null) return 'na';
  if (stock <= 0) return 'agotado';
  return stock <= minimoOf(id) ? 'bajo' : 'disponible';
}

function stockAlcanza(id, qty = 1){
  const stock = stockOf(id);
  if (stock === null) return true;
  return stock >= qty;
}

/** Texto corto para tablas y badges */
function stockLabel(id){
  const stock = stockOf(id);
  if (stock === null) return { text: 'No aplica', cls: 'na' };
  if (stock <= 0) return { text: 'Agotado', cls: 'out' };
  if (stock <= minimoOf(id)) return { text: 'Últimas ' + stock, cls: 'low' };
  return { text: stock + ' disponibles', cls: 'ok' };
}

/** Texto para el prompt del asistente */
function stockPhrase(id){
  const stock = stockOf(id);
  if (stock === null) return 'servicio disponible (sin stock físico)';
  if (stock <= 0) return 'AGOTADO (0 unidades)';
  return stock + (stock === 1 ? ' unidad disponible' : ' unidades disponibles');
}

function setStock(id, cantidad){
  const map = loadStock();
  map[id] = Math.max(0, Math.trunc(Number(cantidad) || 0));
  saveStockMap(map);
  return map[id];
}

function adjustStock(id, delta){
  return setStock(id, stockOf(id) + delta);
}

function setMinimo(id, value){
  const map = loadMinimos();
  map[id] = Math.max(0, Math.trunc(Number(value) || 0));
  saveMinimosMap(map);
  return map[id];
}

function resetStock(){
  localStorage.removeItem(STOCK_KEY);
  localStorage.removeItem(STOCK_MIN_KEY);
  _stockCache = null;
  _minCache = null;
}

/** Resumen para tarjetas y para el asistente del panel */
function stockSummary(){
  const agotados = [], bajos = [], disponibles = [];
  for (const item of CATALOGO){
    const st = stockStatus(item.id);
    if (st === 'agotado') agotados.push(item);
    else if (st === 'bajo') bajos.push(item);
    else if (st === 'disponible') disponibles.push(item);
  }
  return { agotados, bajos, disponibles, total: CATALOGO.length };
}

/** Alternativa parecida que sí tiene stock (misma categoría, nombre parecido y precio cercano) */
function alternativasDe(id, max = 2){
  const base = catalogById(id);
  if (!base) return [];
  const baseToks = new Set(termsOf(base.nombre));
  return CATALOGO
    .filter(i => i.id !== id && tracksStock(i.id) && stockStatus(i.id) !== 'agotado')
    .map(i => {
      const nombreParecido = termsOf(i.nombre).some(t => baseToks.has(t));
      return {
        item: i,
        score: (i.cat === base.cat ? 2 : 0)
          + (nombreParecido ? 3 : 0)
          + (i.unidad === base.unidad ? 1 : 0)
          + (Math.abs(i.precio - base.precio) < base.precio ? 1 : 0)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.item);
}

/** Descuenta unidades vendidas (una cotización enviada, por ejemplo) */
function descontarStock(items){
  const map = loadStock();
  for (const it of items || []){
    if (!tracksStock(it.id)) continue;
    map[it.id] = Math.max(0, (Number(map[it.id]) || 0) - (it.qty || 1));
  }
  saveStockMap(map);
}

/* ---------------- AGENDA ---------------- */

const ESTADOS_CITA = ['pendiente', 'confirmada', 'atendida', 'cancelada'];

/* Horario del taller: turnos de 1 h, hasta 2 motos por turno */
const HORARIO = {
  dias: [1, 2, 3, 4, 5, 6], // 0 = domingo … 6 = sábado
  apertura: 8,
  cierre: 17,
  turnoMin: 60,
  capacidad: 2
};

const DIAS_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad2 = n => String(n).padStart(2, '0');

function horarioTexto(){
  return 'lunes a sábado de 8:00 a 17:00';
}

/** "miércoles 18 de noviembre de 2026" */
function fechaLarga(iso){
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${DIAS_NOMBRE[dt.getDay()]} ${d} de ${MESES_NOMBRE[m - 1]} de ${y}`;
}

/** "18 nov" */
function fechaCorta(iso){
  const [, m, d] = String(iso).split('-').map(Number);
  if (!m || !d) return iso;
  return `${d} ${MESES_NOMBRE[m - 1].slice(0, 3)}`;
}

function esDiaHabil(iso){
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return false;
  return HORARIO.dias.includes(new Date(y, m - 1, d).getDay());
}

/** Turnos del día: 08:00 … 16:00 */
function turnosDelDia(){
  const out = [];
  for (let h = HORARIO.apertura; h < HORARIO.cierre; h++) out.push(pad2(h) + ':00');
  return out;
}

function turnoYaPaso(fecha, hora){
  const dt = new Date(`${fecha}T${hora}:00`);
  return !isNaN(dt.getTime()) && dt.getTime() <= Date.now();
}

function citasEnTurno(fecha, hora){
  return loadAgenda().filter(c => c.fecha === fecha && c.hora === hora && c.estado !== 'cancelada');
}

function libresEnTurno(fecha, hora){
  if (!esDiaHabil(fecha) || turnoYaPaso(fecha, hora)) return 0;
  return Math.max(0, HORARIO.capacidad - citasEnTurno(fecha, hora).length);
}

/** ¿Se puede agendar en esa fecha y hora? */
function citaDisponible(fecha, hora){
  return libresEnTurno(fecha, hora) > 0;
}

/** Estado de cada turno de un día */
function slotsDelDia(fecha){
  if (!esDiaHabil(fecha)) return [];
  return turnosDelDia().map(hora => {
    const ocupadas = citasEnTurno(fecha, hora).length;
    return {
      hora,
      ocupadas,
      libres: Math.max(0, HORARIO.capacidad - ocupadas),
      pasado: turnoYaPaso(fecha, hora),
      cerrado: false
    };
  }).map(s => ({ ...s, libre: !s.pasado && s.libres > 0 }));
}

/** Próximos días hábiles con su disponibilidad (para el chat y el panel) */
function disponibilidadProximos(dias = 8, desde = null){
  const out = [];
  const start = desde || hoyISO();
  let offset = 0;
  let habiles = 0;
  while (habiles < dias && offset < dias * 3 + 14){
    const fecha = isoLocal(new Date(new Date(start + 'T12:00:00').getTime() + offset * 86400000));
    offset++;
    if (!esDiaHabil(fecha)) continue;
    habiles++;
    const slots = slotsDelDia(fecha).filter(s => s.libre);
    out.push({
      fecha,
      dia: fechaLarga(fecha),
      citas: citasDe(fecha).filter(c => c.estado !== 'cancelada').length,
      slots
    });
  }
  return out;
}

/** Texto compacto de cupos para el prompt del chat */
function resumenDisponibilidad(dias = 8){
  const dias_ = disponibilidadProximos(dias);
  if (!dias_.length) return '(sin días hábiles próximos)';
  const lineas = dias_.map(d => {
    if (!d.slots.length) return `- ${d.dia} (${d.fecha}): SIN CUPOS (no ofrecer)`;
    const horas = d.slots.map(s => s.hora).join(', ');
    return `- ${d.dia} (${d.fecha}): se puede agendar a las ${horas}`;
  });
  return lineas.join('\n');
}

function loadAgenda(){
  const list = readJson(AGENDA_KEY, []);
  return Array.isArray(list) ? list : [];
}

function saveAgenda(list){ writeJson(AGENDA_KEY, list); }

function newId(prefix){
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addCita(cita){
  const list = loadAgenda();
  const item = {
    id: newId('cita'),
    cliente: String(cita.cliente || '').trim(),
    telefono: String(cita.telefono || '').trim(),
    servicio: String(cita.servicio || '').trim(),
    fecha: cita.fecha || '',
    hora: cita.hora || '',
    notas: String(cita.notas || '').trim(),
    estado: ESTADOS_CITA.includes(cita.estado) ? cita.estado : 'pendiente',
    origen: cita.origen === 'chat' || cita.origen === 'demo' ? cita.origen : 'panel',
    creada: new Date().toISOString()
  };
  list.push(item);
  saveAgenda(list);
  return item;
}

/**
 * Crea una cita validando datos y cupo.
 * Devuelve { ok:true, cita } o { ok:false, motivo }.
 */
function crearCitaValidada(cita){
  const faltan = [];
  if (!String(cita.cliente || '').trim()) faltan.push('cliente');
  if (!String(cita.telefono || '').trim()) faltan.push('telefono');
  if (!String(cita.servicio || '').trim()) faltan.push('servicio');
  if (faltan.length) return { ok: false, motivo: 'faltan_datos', faltan };

  const fecha = String(cita.fecha || '').slice(0, 10);
  const hora = String(cita.hora || '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) {
    return { ok: false, motivo: 'fecha_invalida' };
  }
  if (!esDiaHabil(fecha)) return { ok: false, motivo: 'cerrado' };
  if (!citaDisponible(fecha, hora)) return { ok: false, motivo: 'sin_cupo' };

  return { ok: true, cita: addCita({ ...cita, fecha, hora, estado: cita.estado || 'pendiente' }) };
}

function updateCita(id, patch){
  const list = loadAgenda();
  const i = list.findIndex(c => c.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch };
  saveAgenda(list);
  return list[i];
}

function removeCita(id){
  saveAgenda(loadAgenda().filter(c => c.id !== id));
}

/** Fecha local en formato AAAA-MM-DD (toISOString usa UTC y de noche adelanta un día) */
function isoLocal(d = new Date()){
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const hoyISO = () => isoLocal();

function citasDe(fecha){ return loadAgenda().filter(c => c.fecha === fecha); }

function proximasCitas(dias = 7){
  const hoy = hoyISO();
  const limite = isoLocal(new Date(Date.now() + dias * 86400000));
  return loadAgenda()
    .filter(c => c.fecha >= hoy && c.fecha <= limite && c.estado !== 'cancelada')
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}

/** Texto compacto de la agenda para el prompt / el asistente */
function agendaResumen(){
  const hoy = citasDe(hoyISO());
  const proximas = proximasCitas(7);
  if (!proximas.length) return 'No hay citas agendadas para hoy ni para los próximos 7 días.';
  const fmt = c => `${c.fecha} ${c.hora} · ${c.cliente} · ${c.telefono || 'sin teléfono'} · ${c.servicio} · ${c.estado}`;
  const partes = [];
  partes.push('Citas de hoy (' + hoy.length + '): ' + (hoy.length ? hoy.map(fmt).join(' | ') : 'ninguna'));
  const resto = proximas.filter(c => c.fecha !== hoyISO());
  if (resto.length) partes.push('Próximas: ' + resto.map(fmt).join(' | '));
  return partes.join('\n');
}

/** Bloque completo de agenda y cupos para el prompt del chat */
function agendaParaPrompt(){
  const proximas = loadAgenda()
    .filter(c => c.fecha >= hoyISO() && c.estado !== 'cancelada')
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const lista = proximas.slice(0, 20)
    .map(c => `- ${c.fecha} ${c.hora} · ${c.servicio} · ${c.estado}`)
    .join('\n');

  return `Horario de atención: ${horarioTexto()}. Turnos de 1 hora, hasta ${HORARIO.capacidad} motos por turno. Cerrado domingos.
Hoy es ${fechaLarga(hoyISO())} (${hoyISO()}).
Los días y horas que aparecen abajo TIENEN CUPO y se pueden reservar. Si una hora no aparece, o el día dice SIN CUPOS, está lleno.
${resumenDisponibilidad(8)}

Citas ya agendadas (solo informativo; cada turno admite hasta ${HORARIO.capacidad} motos, así que puede haber una cita y aún quedar cupo):
${lista || '(ninguna)'}${proximas.length > 20 ? `\n(y ${proximas.length - 20} citas más)` : ''}`;
}

/* =========================================================
   DATOS DE PRUEBA (demo)
========================================================= */
const DEMO_NOMBRES = [
  'María Gómez', 'Carlos Pérez', 'Ana Rodríguez', 'Juan Martínez', 'Laura Sánchez',
  'Andrés Ramírez', 'Diana Torres', 'Jorge Herrera', 'Paula Restrepo', 'Santiago Méndez',
  'Valentina Ríos', 'Felipe Cárdenas', 'Camila Vargas', 'Diego Ospina', 'Natalia Castro',
  'Sebastián Duque', 'Juliana Pardo', 'Mauricio Salazar', 'Carolina Zapata', 'Óscar Muñoz'
];

const DEMO_SERVICIOS = [
  'Cambio de aceite y filtro',
  'Mantenimiento preventivo completo',
  'Ajuste y lubricación de cadena',
  'Revisión de frenos',
  'Diagnóstico eléctrico'
];

/** Borra solo las citas marcadas como de prueba */
function borrarCitasDemo(){
  const antes = loadAgenda().length;
  saveAgenda(loadAgenda().filter(c => c.origen !== 'demo'));
  return antes - loadAgenda().length;
}

/**
 * Crea citas de prueba repartidas en días hábiles (lun-sáb): deja el
 * tercer día hábil completo (2 motos por turno) para probar el rechazo
 * por falta de cupo y deja libres los demás turnos.
 */
function seedCitasDemo(total = 40){
  borrarCitasDemo();

  const dias = [];
  for (let i = 1; dias.length < 30 && i < 120; i++){
    const f = isoLocal(new Date(Date.now() + i * 86400000));
    if (esDiaHabil(f)) dias.push(f);
  }
  if (dias.length < 4) return { creadas: 0, diaLleno: '' };

  const horas = turnosDelDia();
  const diaLleno = dias[2];
  const pares = [];

  // Día completo: 2 citas en cada turno
  for (const h of horas) for (let k = 0; k < HORARIO.capacidad; k++) pares.push({ fecha: diaLleno, hora: h });

  // Resto repartido, con algunos días con 2 citas
  const rot = ['08:00', '10:00', '12:00', '14:00', '16:00', '09:00', '15:00'];
  let i = 0;
  for (const f of dias){
    if (pares.length >= total) break;
    if (f === diaLleno) continue;
    const hora = rot[i % rot.length];
    pares.push({ fecha: f, hora });
    if (i % 4 === 0) pares.push({ fecha: f, hora: rot[(i + 2) % rot.length] });
    i++;
  }
  pares.length = Math.min(pares.length, total);

  const estados = ['confirmada', 'confirmada', 'pendiente', 'atendida'];
  let creadas = 0;
  pares.forEach((p, idx) => {
    // no superar la capacidad del turno
    if (citasEnTurno(p.fecha, p.hora).length >= HORARIO.capacidad) return;
    addCita({
      cliente: DEMO_NOMBRES[idx % DEMO_NOMBRES.length],
      telefono: '3' + String(100000000 + idx * 7919).slice(0, 9),
      servicio: DEMO_SERVICIOS[idx % DEMO_SERVICIOS.length],
      fecha: p.fecha,
      hora: p.hora,
      notas: 'Cita de prueba',
      estado: estados[idx % estados.length],
      origen: 'demo'
    });
    creadas++;
  });

  return { creadas, diaLleno, desde: pares[0] ? pares[0].fecha : '', hasta: pares[pares.length - 1] ? pares[pares.length - 1].fecha : '' };
}

/** Cuántas citas de prueba hay ahora */
function contarCitasDemo(){
  return loadAgenda().filter(c => c.origen === 'demo').length;
}

const AUTOSEED_KEY = 'motobot_agenda_seeded';

/**
 * Carga las 40 citas de prueba la primera vez que se abre la app
 * (solo si la agenda está vacía y no se ha sembrado antes).
 * Devuelve cuántas creó (0 si no hizo nada).
 */
function ensureAgendaDemo(){
  if (localStorage.getItem(AUTOSEED_KEY)) return 0;
  if (loadAgenda().length){
    localStorage.setItem(AUTOSEED_KEY, '1');
    return 0;
  }
  const res = seedCitasDemo(40);
  localStorage.setItem(AUTOSEED_KEY, '1');
  return res.creadas;
}

/** Marca que ya no se vuelvan a sembrar solas (tras borrarlas a mano) */
function markAgendaSeeded(){
  localStorage.setItem(AUTOSEED_KEY, '1');
}
