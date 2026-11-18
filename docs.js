/* =========================================================
   LECTURA DE ADJUNTOS (imágenes, texto y PDF)
   Sin dependencias: usa DecompressionStream del navegador.
   Uso: extractAttachment(file) -> { ok, kind, name, ... } | { ok:false, error }
========================================================= */

const ATTACH_MAX_BYTES = 15 * 1024 * 1024;      // 15 MB por archivo
const ATTACH_MAX_TEXT = 8000;                    // caracteres de texto por archivo
const ATTACH_MAX_PDF_IMAGES = 3;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|log|html?|xml|yml|yaml|ini|cfg)$/i;

function fileToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

function blobToBytes(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.onload = () => resolve(new Uint8Array(r.result));
    r.readAsArrayBuffer(blob);
  });
}

/* Reduce una imagen a JPEG para no gastar tokens */
function shrinkImageBlob(blob, maxSide = 1280, quality = 0.82){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El archivo no es una imagen válida')); };
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = url;
  });
}

/* ---------------- PDF ---------------- */

function bytesToLatin1(bytes){
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH){
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return out;
}

async function inflateBytes(bytes, raw = false){
  if (typeof DecompressionStream === 'undefined'){
    throw new Error('sin_descompresion');
  }
  const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true){
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks){ out.set(c, off); off += c.length; }
  return out;
}

async function inflateAuto(bytes){
  try { return await inflateBytes(bytes, false); }
  catch (e) { return await inflateBytes(bytes, true); }
}

function decodePdfString(raw){
  if (!raw) return '';
  if (raw[0] === '<'){
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    let s = '';
    if (/^FEFF/i.test(hex)){
      for (let i = 4; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    } else {
      for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return s;
  }
  return raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, g) => {
    if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
    const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    return map[g] !== undefined ? map[g] : g;
  });
}

/** Texto aproximado de un content stream de PDF */
function textFromContent(content){
  const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)|(TJ|Tj|T\*|Td|TD|Tm|ET|BT)|(\[|\])/g;
  let m, inArr = false, arr = [], pend = '', out = '';
  while ((m = re.exec(content))){
    if (m[1]){
      const s = decodePdfString(m[1]);
      if (inArr) arr.push(s); else pend += s;
    } else if (m[3] === '['){
      inArr = true; arr = [];
    } else if (m[3] === ']'){
      inArr = false;
    } else if (m[2]){
      const op = m[2];
      if (op === 'Tj'){ out += pend; pend = ''; }
      else if (op === 'TJ'){ out += arr.join(''); arr = []; }
      else if (op === 'ET' || op === 'Td' || op === 'TD' || op === 'T*'){ out += '\n'; }
      else { out += ' '; }
    }
  }
  if (pend) out += pend;
  return out
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Deshace los filtros PNG (Predictor 10-15) de una imagen en Flate */
function unfilterRows(data, rowLen, bpp, predictor){
  if (predictor < 10) return data;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++){
    const ft = data[r * (rowLen + 1)];
    const row = data.subarray(r * (rowLen + 1) + 1, r * (rowLen + 1) + 1 + rowLen);
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++){
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = row[i];
      let v = x;
      if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4){
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev = cur;
  }
  return out;
}

/** Convierte píxeles crudos a JPEG usando canvas */
function rawPixelsToDataUrl(bytes, width, height, comps){
  if (!width || !height || width * height > 12e6) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const px = imageData.data;
  const n = width * height;
  for (let i = 0; i < n; i++){
    let r, g, b;
    if (comps === 1){ r = g = b = bytes[i]; }
    else if (comps === 3){ r = bytes[i * 3]; g = bytes[i * 3 + 1]; b = bytes[i * 3 + 2]; }
    else if (comps === 4){
      const c = bytes[i * 4], m = bytes[i * 4 + 1], y = bytes[i * 4 + 2], k = bytes[i * 4 + 3];
      r = 255 - Math.min(255, c + k);
      g = 255 - Math.min(255, m + k);
      b = 255 - Math.min(255, y + k);
    } else return null;
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Recorta los bytes del stream usando /Length (el salto de línea previo a
 *  "endstream" no forma parte de los datos y rompe la descompresión). */
function streamSlice(body, dict, sIdx, eStart){
  const sStart = sIdx + (body[sIdx + 6] === '\r' ? 8 : 7);
  const lenMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
  if (lenMatch){
    const end = Math.min(eStart, sStart + Number(lenMatch[1]));
    return body.slice(sStart, end);
  }
  return body.slice(sStart, eStart).replace(/[\r\n]+$/, '');
}

/**
 * Extrae texto e imágenes de un PDF.
 * Devuelve { text, images:[dataUrl], scanned }.
 */
async function extractPdf(bytes){
  const raw = bytesToLatin1(bytes);
  if (/\/Encrypt\s/.test(raw.slice(-200000))) throw new Error('pdf_cifrado');

  const images = [];
  const textos = [];
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;

  while ((m = objRe.exec(raw))){
    const start = m.index;
    const endObj = raw.indexOf('endobj', start);
    const body = raw.slice(start, endObj < 0 ? start + 400000 : endObj);
    const sIdx = body.search(/\bstream\r?\n/);
    if (sIdx < 0) continue;
    const dict = body.slice(0, sIdx);
    const eStart = body.indexOf('endstream', sIdx);
    if (eStart < 0) continue;
    const chunk = streamSlice(body, dict, sIdx, eStart);
    const data = Uint8Array.from(chunk, c => c.charCodeAt(0) & 0xff);
    const esImagen = /\/Subtype\s*\/Image/.test(dict);

    try {
      if (esImagen){
        if (images.length >= ATTACH_MAX_PDF_IMAGES) continue;
        if (/\/DCTDecode/.test(dict)){
          const url = await shrinkImageBlob(new Blob([data], { type: 'image/jpeg' }));
          if (url) images.push(url);
        } else if (/\/FlateDecode/.test(dict)){
          const w = Number((dict.match(/\/Width\s+(\d+)/) || [])[1]);
          const h = Number((dict.match(/\/Height\s+(\d+)/) || [])[1]);
          const bpc = Number((dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1] || 8);
          const pred = Number((dict.match(/\/Predictor\s+(\d+)/) || [])[1] || 1);
          if (!w || !h || bpc !== 8) continue;
          const comps = /\/DeviceRGB|\/CalRGB/.test(dict) ? 3
            : /\/DeviceCMYK/.test(dict) ? 4
            : /\/DeviceGray/.test(dict) ? 1 : 0;
          if (!comps) continue;
          let px = await inflateAuto(data);
          px = unfilterRows(px, w * comps, comps, pred);
          const url = rawPixelsToDataUrl(px, w, h, comps);
          if (url) images.push(url);
        }
      } else if (/\/FlateDecode/.test(dict)){
        const txt = textFromContent(bytesToLatin1(await inflateAuto(data)));
        if (txt) textos.push(txt);
      } else if (!/\/Subtype/.test(dict)){
        const txt = textFromContent(chunk);
        if (txt) textos.push(txt);
      }
    } catch (e){ /* seguimos con el siguiente objeto */ }
  }

  const text = textos.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const letras = (text.match(/[a-záéíóúñA-ZÁÉÍÓÚÑ]/g) || []).length;
  return { text, images, scanned: letras < 30 };
}

/* ---------------- API ÚNICA ---------------- */

function isImageFile(file){ return /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name); }
function isPdfFile(file){ return file.type === 'application/pdf' || /\.pdf$/i.test(file.name); }
function isTextFile(file){ return /^text\//.test(file.type) || TEXT_EXT.test(file.name); }

/**
 * Lee un archivo y devuelve el adjunto listo para el chat:
 *  { ok:true, kind:'image', name, dataUrl }
 *  { ok:true, kind:'doc', name, text, images:[...], truncado }
 *  { ok:false, error:'mensaje' }
 */
async function extractAttachment(file){
  if (!file) return { ok: false, error: 'Archivo vacío' };
  if (file.size > ATTACH_MAX_BYTES) return { ok: false, error: 'El archivo supera los 15 MB' };

  try {
    if (isImageFile(file)){
      const dataUrl = await shrinkImageBlob(file);
      return { ok: true, kind: 'image', name: file.name || 'imagen.jpg', dataUrl };
    }

    if (isPdfFile(file)){
      if (typeof DecompressionStream === 'undefined'){
        return { ok: false, error: 'Este navegador no puede leer PDF: usa Chrome, Edge o Firefox actualizado' };
      }
      const { text, images, scanned } = await extractPdf(await blobToBytes(file));
      if (!text && !images.length){
        return { ok: false, error: 'No pude extraer contenido de ese PDF (puede estar protegido o escaneado)' };
      }
      const recorte = text.length > ATTACH_MAX_TEXT;
      return {
        ok: true,
        kind: 'doc',
        name: file.name,
        text: recorte ? text.slice(0, ATTACH_MAX_TEXT) : text,
        images,
        truncado: recorte,
        escaneado: scanned
      };
    }

    if (isTextFile(file)){
      const text = await file.text();
      const recorte = text.length > ATTACH_MAX_TEXT;
      return {
        ok: true,
        kind: 'doc',
        name: file.name,
        text: recorte ? text.slice(0, ATTACH_MAX_TEXT) : text,
        images: [],
        truncado: recorte,
        escaneado: false
      };
    }

    return { ok: false, error: 'Formato no compatible: adjunta imágenes, PDF o texto (.txt, .md, .csv, .json)' };
  } catch (err){
    const motivos = {
      pdf_cifrado: 'El PDF está protegido con contraseña',
      sin_descompresion: 'Este navegador no puede leer PDF (usa Chrome, Edge o Firefox actualizado)'
    };
    return { ok: false, error: motivos[err.message] || ('No se pudo leer el archivo: ' + err.message) };
  }
}

/** Bloque de contexto para el prompt con los documentos adjuntos */
function attachmentsPrompt(attachments){
  const docs = (attachments || []).filter(a => a.kind === 'doc');
  if (!docs.length) return '';
  const partes = docs.map((d, i) => {
    const nota = d.escaneado ? '\n(El PDF parece escaneado: el texto puede ser incompleto.)' : '';
    return `--- Documento ${i + 1}: ${d.name} ---\n${d.text || '(sin texto extraíble)'}${nota}`;
  });
  return `\n\n=== DOCUMENTOS ADJUNTOS POR EL USUARIO (PRIORIDAD ALTA: úsalos para responder) ===\n${partes.join('\n\n')}\n=== FIN DE LOS DOCUMENTOS ===`;
}
