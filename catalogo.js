/* =========================================================
   CATÁLOGO COMPARTIDO (chat + página de catálogo)
   Precios en pesos colombianos (COP)
========================================================= */

/* WhatsApp del equipo de soporte: número internacional sin + */
const WHATSAPP_NUMBER = '573177366474';

const CATALOGO = [
  { id:'aceite-10w40', nombre:'Aceite 10W-40 semisintético', cat:'Consumible', precio:32000, unidad:'litro', detalle:'JASO MA2, uso mixto ciudad/carretera.' },
  { id:'filtro-aceite', nombre:'Filtro de aceite', cat:'Repuesto', precio:18000, unidad:'unidad', detalle:'Compatible con motos 125-250 cc de uso común.' },
  { id:'bujia-ngk', nombre:'Bujía NGK CPR8EA-9', cat:'Repuesto', precio:15000, unidad:'unidad', detalle:'Referencia de fábrica para Honda CB190R y similares.' },
  { id:'kit-arrastre', nombre:'Kit de arrastre (cadena, piñón y catalina)', cat:'Repuesto', precio:145000, unidad:'kit', detalle:'Cadena 428H reforzada con piñón y catalina.' },
  { id:'pastillas-freno', nombre:'Pastillas de freno delanteras', cat:'Repuesto', precio:45000, unidad:'juego', detalle:'Compuesto orgánico, para disco ventilado.' },
  { id:'liquido-frenos', nombre:'Líquido de frenos DOT 4', cat:'Consumible', precio:22000, unidad:'500 ml', detalle:'Punto de ebullición alto, uso general.' },
  { id:'filtro-aire', nombre:'Filtro de aire', cat:'Repuesto', precio:25000, unidad:'unidad', detalle:'Filtro de papel seco, lavable con aire comprimido.' },
  { id:'llanta-delantera', nombre:'Llanta delantera 90/90-17', cat:'Repuesto', precio:180000, unidad:'unidad', detalle:'Uso mixto, índice de carga estándar.' },
  { id:'llanta-trasera', nombre:'Llanta trasera 110/80-17', cat:'Repuesto', precio:210000, unidad:'unidad', detalle:'Uso mixto, compuesto de larga duración.' },
  { id:'bateria', nombre:'Batería 12V 5Ah sellada', cat:'Repuesto', precio:135000, unidad:'unidad', detalle:'Libre de mantenimiento, con garantía de 6 meses.' },
  { id:'bombillo-led', nombre:'Kit de luces LED', cat:'Accesorio', precio:60000, unidad:'kit', detalle:'Luz blanca 6000K, instalación plug and play.' },
  { id:'espejos', nombre:'Espejos retrovisores (par)', cat:'Accesorio', precio:38000, unidad:'par', detalle:'Rosca 10 mm, ajustables.' },
  { id:'servicio-aceite', nombre:'Servicio: cambio de aceite y filtro', cat:'Servicio', precio:25000, unidad:'servicio', detalle:'Mano de obra. No incluye repuestos.' },
  { id:'servicio-preventivo', nombre:'Servicio: mantenimiento preventivo completo', cat:'Servicio', precio:120000, unidad:'servicio', detalle:'Revisión de 18 puntos, ajustes y limpieza.' },
  { id:'servicio-cadena', nombre:'Servicio: ajuste y lubricación de cadena', cat:'Servicio', precio:15000, unidad:'servicio', detalle:'Limpieza, lubricación y tensión.' },
  { id:'moto-cb190r', nombre:'Moto Honda CB190R', cat:'Moto nueva', precio:9990000, unidad:'unidad', detalle:'Modelo 2024, 0 km, matrícula incluida.' },
  { id:'moto-xr150l', nombre:'Moto Honda XR150L', cat:'Moto nueva', precio:8490000, unidad:'unidad', detalle:'Modelo 2024, 0 km, doble propósito.' },
  { id:'moto-nkd125', nombre:'Moto AKT NKD 125', cat:'Moto nueva', precio:5290000, unidad:'unidad', detalle:'Modelo 2024, 0 km, urbana.' },
  { id:'moto-ns200', nombre:'Moto Bajaj NS 200', cat:'Moto nueva', precio:10990000, unidad:'unidad', detalle:'Modelo 2024, 0 km, naked deportiva.' }
];

const money = n => '$ ' + Number(n).toLocaleString('es-CO') + ' COP';
const catalogById = id => CATALOGO.find(x => x.id === id);

/* =========================================================
   BÚSQUEDA DENTRO DEL CATÁLOGO
========================================================= */
const STOP = new Set(['de','la','el','los','las','un','una','unos','unas','y','o','que','en','con','por',
  'para','del','al','se','es','son','como','mi','me','su','sus','lo','le','les','mas','pero','si','no',
  'muy','este','esta','estos','estas','hay','ser','the','of','to','and','a','in','is','it','for','on','with']);

function normalize(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function tokenize(s){
  return normalize(s).split(/[^a-z0-9ñ]+/).filter(t => t.length > 2 && !STOP.has(t));
}
/** Raíz simple: quita plural y recorta a 6 letras (presión/presiones, bujía/bujías) */
function stem(t){
  const s = (t.length > 4 && t.endsWith('s')) ? t.slice(0, -1) : t;
  return s.length > 6 ? s.slice(0, 6) : s;
}
function termsOf(s){
  return tokenize(s).map(stem);
}

/** Palabras que no identifican un artículo (preguntas, cortesías, genéricos) */
const QUERY_NOISE = new Set([
  'quiero','necesito','solicito','cotizar','cotizacion','cotiza','precio','precios','cuanto',
  'cuesta','cuestan','vale','valen','total','informacion','favor','gracias','hola','articulo',
  'articulos','producto','productos','comprar','compra','moto','motos','saber','dime','tienes','venden'
].map(stem));

/** Raíces de los nombres del catálogo + frecuencia de cada palabra (para pesar por rareza) */
function catalogIndex(){
  const clean = toks => toks.filter(t => !/^\d+$/.test(t));
  const names = CATALOGO.map(i => clean([...new Set(termsOf(i.nombre))]));
  const df = new Map();
  for (const toks of names) for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log(1 + CATALOGO.length / (df.get(t) || 1));
  return { names, df, idf };
}

/** Compara raíces permitiendo prefijos ("10w40" ~ "10w") */
function softTerm(a, b){
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** Artículos del catálogo mencionados en el texto, con su cantidad */
function matchCatalog(text, max = 4){
  const q = [...new Set(termsOf(text))]
    .filter(t => !QUERY_NOISE.has(t) && !/^\d+$/.test(t));
  if (!q.length) return [];

  const { names, df, idf } = catalogIndex();
  const queryW = q.reduce((s, t) => s + idf(t), 0) || 1;

  return CATALOGO.map((item, idx) => {
    const toks = names[idx];
    const totalW = toks.reduce((s, t) => s + idf(t), 0) || 1;
    const hitW = toks.filter(t => q.some(qt => softTerm(qt, t))).reduce((s, t) => s + idf(t), 0);
    const qHitW = q.filter(t => toks.some(it => softTerm(t, it))).reduce((s, t) => s + idf(t), 0);

    let score = (hitW / totalW) * (qHitW / queryW);
    // Una palabra exclusiva del catálogo ("bujía", "arrastre", "cb190r") identifica el artículo
    const unique = toks.some(t => df.get(t) === 1 && q.some(qt => softTerm(qt, t)));
    if (unique) score = Math.max(score, 0.8);
    // "2 litros de aceite" apunta al artículo que se vende por litro
    if (item.unidad === 'litro' && /\b(?:\d{1,2}|un|una|dos|tres|cuatro|cinco)\s+litros?\b/.test(normalize(text))) score = Math.max(score, 0.8);

    return { item, score };
  }).filter(x => x.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ item }) => ({ item, qty: quantityFor(item, text) }));
}

const NUM_WORDS = { un:1, una:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 };
const QTY_UNIT = '(?:unidades?|pares?|juegos?|kits?|litros?|botellas?|servicios?|cambios?|docenas?)';

/** Cantidad escrita junto al artículo ("2 bujías", "2 litros de aceite", "tres filtros") */
function quantityFor(item, text){
  const t = ' ' + normalize(text).replace(/\s+/g, ' ') + ' ';
  const words = normalize(item.nombre).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3);
  for (const w of words){
    const re = new RegExp('(\\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\\s*(?:x|×)?\\s*' + QTY_UNIT + '?\\s*(?:de\\s+)?' + w);
    const m = t.match(re);
    if (!m) continue;
    const qty = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUM_WORDS[m[1]];
    if (qty > 0) return Math.max(1, Math.min(20, qty));
  }
  return 1;
}

/** El usuario está pidiendo precio/cotización (no basta con nombrar un artículo) */
const PRICE_INTENT = /\b(?:cotiz\w*|presupuest\w*|precios?|costos?|costar\w*|cuesta|cuestan|vale|valen|catalogo|comprar\w*|adquirir|tarifas?|dame|deme|aparta|reserva|encarga|mandame|enviame)\b|\bcuanto\s+(?:cuesta|cuestan|vale|valen|sale|salen|costaria|saldria|valdria|costar|es)\b|\bque\s+precio\b/;

function hasPriceIntent(text){
  return PRICE_INTENT.test(normalize(text || ''));
}

/** Cotización { items:[{...artículo, qty, subtotal}], total } a partir de un texto libre */
function buildQuote(text){
  if (!hasPriceIntent(text)) return { items: [], total: 0 };
  const items = matchCatalog(text)
    .map(({ item, qty }) => ({ ...item, qty, subtotal: item.precio * qty }));
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  return { items, total };
}

/** Enlace de WhatsApp con el mensaje ya escrito */
function waLink(message){
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
