/* =========================================================
   CONFIGURACIÓN COMPARTIDA DEL ASISTENTE
   (panel de super usuario + chat)
========================================================= */

/* Proveedores (API compatible con el formato OpenAI para chat/completions) */
const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    keyField: 'motobot_key_openai',
    modelField: 'motobot_model_openai',
    defaultModel: 'gpt-4o-mini',
    initialModel: 'gpt-4o-mini',
    search: 'openai',
    vision: true,
    models: [
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'gpt-4.1', label: 'gpt-4.1' }
    ]
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com',
    keyField: 'motobot_key_deepseek',
    modelField: 'motobot_model_deepseek',
    defaultModel: 'deepseek-flash',
    initialModel: 'auto',
    search: 'deepseek',
    vision: false,
    models: [
      { value: 'auto', label: 'Recomendado (deepseek-flash)' },
      { value: 'deepseek-flash', label: 'deepseek-flash · V4.1 Flash' },
      { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro · V4 Pro' }
    ]
  }
};

/* Pensamiento de DeepSeek: false = más rápido y barato; true = razona antes de responder */
const DEEPSEEK_THINKING = false;

/* Claves de almacenamiento */
const APP_KEYS = {
  provider: 'motobot_provider',
  temp: 'motobot_temp',
  mode: 'motobot_mode',
  doc: 'motobot_doc',
  admin: 'motobot_admin'
};

function currentProvider(){
  return localStorage.getItem(APP_KEYS.provider) === 'deepseek' ? 'deepseek' : 'openai';
}

/** Lee la configuración de API que administra el super usuario */
function readApiConfig(){
  const provider = currentProvider();
  const cfg = PROVIDERS[provider];
  return {
    provider,
    apiKey: localStorage.getItem(cfg.keyField) || '',
    model: localStorage.getItem(cfg.modelField) || cfg.initialModel,
    temperature: parseFloat(localStorage.getItem(APP_KEYS.temp) || '0.2')
  };
}

/** Guarda la configuración de API */
function saveApiConfig({ provider, apiKey, model, temperature }){
  const key = PROVIDERS[provider] ? provider : 'openai';
  const cfg = PROVIDERS[key];
  localStorage.setItem(APP_KEYS.provider, key);
  localStorage.setItem(cfg.keyField, String(apiKey || '').trim());
  localStorage.setItem(cfg.modelField, model || cfg.initialModel);
  if (typeof temperature === 'number' && !isNaN(temperature)){
    localStorage.setItem(APP_KEYS.temp, String(temperature));
  }
}

/** Borra la API key del proveedor indicado */
function clearApiKey(provider){
  const cfg = PROVIDERS[provider];
  if (cfg) localStorage.removeItem(cfg.keyField);
}

/** ¿Ya hay una API configurada y lista para usar? */
function apiConfigured(){
  return !!readApiConfig().apiKey;
}

/** Modelo real a enviar (la opción "auto" se resuelve al modelo por defecto) */
function resolveModel(provider, model){
  const cfg = PROVIDERS[provider] || PROVIDERS.openai;
  return model === 'auto' ? cfg.defaultModel : (model || cfg.initialModel);
}

/** Divide el documento técnico en fragmentos ~1000 caracteres */
function buildChunks(text, maxLen = 1000){
  const blocks = String(text || '').split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  const flat = [];
  for (const b of blocks){
    if (b.length <= maxLen) flat.push(b);
    else {
      let i = 0;
      while (i < b.length){ flat.push(b.slice(i, i + maxLen)); i += maxLen - 150; }
    }
  }
  const chunks = []; let cur = '';
  for (const b of flat){
    if (cur && (cur + '\n\n' + b).length > maxLen){ chunks.push(cur); cur = b; }
    else cur = cur ? cur + '\n\n' + b : b;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Muestra una key enmascarada para el panel */
function maskKey(key){
  if (!key) return '';
  if (key.length <= 10) return '••••';
  return key.slice(0, 6) + '…' + key.slice(-4);
}
