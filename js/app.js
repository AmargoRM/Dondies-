// Premios Dundies – Dirección de Aguas
// Sin cuentas: cada dispositivo tiene una llave propia y los límites se
// cuentan por dispositivo. Los datos se guardan como mensajes firmados en
// varios servidores públicos de la red Nostr a la vez (gratis, sin registro).
// Cada dispositivo solo puede escribir sus propios datos, y solo el
// organizador puede cambiar fechas y categorías.
'use strict';

const N = window.NostrTools;
const RELAYS = (window.DUNDIES_CONFIG || {}).RELAYS || [
  'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net',
  'wss://nostr.mom', 'wss://relay.snort.social', 'wss://offchain.pub',
];
const KIND = 30078; // datos de aplicación (reemplazables)
const LIMITES = { propuestas: 15, votosDia: 5, oficiales: 15, finalistas: 3 };
const ZONA = 'America/Costa_Rica';

const ICONS = {
  gota: '💧', trofeo: '🏆', ola: '🌊', cafe: '☕', risa: '😂', estrella: '⭐',
  fiesta: '🎉', cerebro: '🧠', rayo: '⚡', corazon: '❤️', reloj: '⏰', telefono: '📞',
  llave: '🔧', grafico: '📊', micro: '🎤', tortuga: '🐢', cohete: '🚀', pizza: '🍕',
  sol: '☀️', planta: '🌱', camion: '🚚', casco: '⛑️',
};
const OLA = '<svg class="ola" viewBox="0 0 400 52" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M0 22 C60 2 120 42 200 22 S340 2 400 22 V52 H0z" fill="#a8e6fb"/>' +
  '<path d="M0 32 C70 14 130 50 210 32 S350 14 400 32 V52 H0z" fill="#5ccdf5"/></svg>';
const GOTA = '<img class="mascota-mini" src="img/gota.svg" alt="">';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $modal = document.getElementById('modal');

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function fecha(iso) {
  return new Date(iso).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
}
function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function hoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function idAleatorio(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function leerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navegador sin almacenamiento */ } }

let toastTimer = null;
function toast(msg, esError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'visible' + (esError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, esError ? 6000 : 3000);
}
function aviso(msg, tipo = 'error') { return `<div class="aviso ${tipo}">${esc(msg)}</div>`; }

async function accion(boton, fn, mensajeOk) {
  if (boton) boton.disabled = true;
  try {
    await fn();
    if (mensajeOk) toast(mensajeOk);
    return true;
  } catch (e) {
    toast(e.message || 'Algo salió mal. Intente de nuevo.', true);
    return false;
  } finally {
    if (boton) boton.disabled = false;
  }
}

// ------------------------------------------------------------------
// Identidad del dispositivo, sala y organizador
// ------------------------------------------------------------------
const esHex64 = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);
const params = new URLSearchParams(location.search);
const SALA = (params.get('sala') || (window.DUNDIES_CONFIG || {}).SALA || '').toLowerCase();
const D_CONFIG = `dundies:${SALA}:config`;
const D_DEV = `dundies:${SALA}:dev`;

let claveDispositivo = leerLocal('dundies_clave');
if (!esHex64(claveDispositivo)) {
  claveDispositivo = N.utils.bytesToHex(N.generateSecretKey());
  guardarLocal('dundies_clave', claveDispositivo);
}
const DISPOSITIVO = N.getPublicKey(N.utils.hexToBytes(claveDispositivo));

if (esHex64(params.get('admin')) && SALA) guardarLocal('dundies_admin_' + SALA, params.get('admin'));
const CLAVE_ADMIN = SALA ? leerLocal('dundies_admin_' + SALA) : null;
const esAdmin = esHex64(CLAVE_ADMIN) && N.getPublicKey(N.utils.hexToBytes(CLAVE_ADMIN)) === SALA;

// Quita ?admin=… de la barra de direcciones para que no se comparta por error.
if (params.get('admin')) {
  params.delete('admin');
  history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
}

// ------------------------------------------------------------------
// Almacenamiento compartido (servidores Nostr)
// ------------------------------------------------------------------
// Hay dos tipos de mensaje, ambos "reemplazables" (el más nuevo gana):
//  * config: fechas y cambios del organizador. Solo vale si lo firma la llave del organizador.
//  * dev:    propuestas, votos, nominaciones y reportes de UN dispositivo, firmado por él.
const pool = new N.SimplePool();
let doc = null;
let eventosPropios = {};   // último mensaje publicado por este dispositivo, por tipo
let eventoConfig = null;
let yaReenviado = false;

const texto = (v, max) => String(v ?? '').slice(0, max);

function ultimoPorAutor(eventos) {
  const m = {};
  for (const e of eventos) if (!m[e.pubkey] || e.created_at > m[e.pubkey].created_at) m[e.pubkey] = e;
  return m;
}

function leerJSON(e) {
  try { const x = JSON.parse(e.content); return x && typeof x === 'object' ? x : null; } catch (err) { return null; }
}

async function leerDoc() {
  let cfgEvs;
  let devEvs;
  try {
    [cfgEvs, devEvs] = await Promise.all([
      pool.querySync(RELAYS, { kinds: [KIND], authors: [SALA], '#d': [D_CONFIG] }, { maxWait: 7000 }),
      pool.querySync(RELAYS, { kinds: [KIND], '#d': [D_DEV], limit: 5000 }, { maxWait: 7000 }),
    ]);
  } catch (e) {
    throw new Error('No hay conexión con los servidores. Revise su internet.');
  }
  const cfgEv = ultimoPorAutor(cfgEvs)[SALA];
  const cfg = cfgEv && leerJSON(cfgEv);
  if (!cfg || !cfg.config) throw new Error('No se pudo cargar el concurso. Revise su internet y que el enlace esté completo.');
  eventoConfig = cfgEv;

  const d = { app: 'dundies', config: cfg.config, cats: {}, dev: {} };
  const porAutor = ultimoPorAutor(devEvs);
  for (const [pk, ev] of Object.entries(porAutor)) {
    const x = leerJSON(ev);
    if (!x) continue;
    if (pk === DISPOSITIVO) eventosPropios.dev = ev;
    const m = {
      v1: {}, nom: {}, v3: {}, v3d: {}, rep: {}, cats: {},
    };
    for (const [dia, lista] of Object.entries(x.v1 || {})) if (Array.isArray(lista)) m.v1[texto(dia, 10)] = lista.slice(0, 20).map((i) => texto(i, 40));
    for (const [c, n] of Object.entries(x.nom || {})) m.nom[texto(c, 40)] = texto(n, 50);
    for (const [c, n] of Object.entries(x.v3 || {})) m.v3[texto(c, 40)] = texto(n, 60);
    for (const [dia, n] of Object.entries(x.v3d || {})) m.v3d[texto(dia, 10)] = Number(n) || 0;
    for (const [c, n] of Object.entries(x.rep || {})) m.rep[texto(c, 40)] = texto(n, 200);
    // Una categoría solo vale si su código empieza con la llave de quien la propuso.
    for (const [id, c] of Object.entries(x.cats || {}).slice(0, 15)) {
      if (!id.startsWith(pk.slice(0, 10)) || !c) continue;
      m.cats[id] = { n: texto(c.n, 60), r: texto(c.r, 140), i: ICONS[c.i] ? c.i : 'gota', t: texto(c.t, 30) };
      d.cats[id] = { ...m.cats[id], d: pk, st: 'a' };
    }
    d.dev[pk] = m;
  }
  // Cambios del organizador (editar, ocultar, fusionar).
  for (const [id, o] of Object.entries(cfg.over || {})) {
    if (!d.cats[id] || !o) continue;
    Object.assign(d.cats[id], {
      n: texto(o.n, 60) || d.cats[id].n, r: texto(o.r, 140) || d.cats[id].r,
      i: ICONS[o.i] ? o.i : d.cats[id].i, st: ['a', 'h', 'm'].includes(o.st) ? o.st : 'a', m: o.m ? texto(o.m, 40) : undefined,
    });
  }

  // Una vez por visita, reenvía la configuración y lo propio para que no se pierdan.
  if (!yaReenviado) {
    yaReenviado = true;
    const reenviar = [cfgEv].concat(eventosPropios.dev ? [eventosPropios.dev] : []);
    if (esAdmin) reenviar.push(...Object.values(porAutor));
    for (const e of reenviar) pool.publish(RELAYS, e).forEach((p) => p.catch(() => {}));
  }
  return d;
}

async function publicarEvento(clave, dTag, contenido, anterior) {
  const ahora = Math.floor(Date.now() / 1000);
  const ev = N.finalizeEvent({
    kind: KIND,
    created_at: Math.max(ahora, (anterior ? anterior.created_at : 0) + 1),
    tags: [['d', dTag]],
    content: JSON.stringify(contenido),
  }, N.utils.hexToBytes(clave));
  const res = await Promise.allSettled(pool.publish(RELAYS, ev, { maxWait: 8000 }));
  if (!res.some((r) => r.status === 'fulfilled')) {
    throw new Error('No se pudo guardar: no hay conexión con los servidores. Revise su internet e intente de nuevo.');
  }
  return ev;
}

function contenidoDispositivo(d) {
  const m = d.dev[DISPOSITIVO] || {};
  const cats = {};
  for (const [id, c] of Object.entries(d.cats)) {
    if (c.d !== DISPOSITIVO) continue;
    cats[id] = (m.cats && m.cats[id]) || { n: c.n, r: c.r, i: c.i, t: c.t };
  }
  return { v1: m.v1 || {}, nom: m.nom || {}, v3: m.v3 || {}, v3d: m.v3d || {}, rep: m.rep || {}, cats };
}

function contenidoConfig(d) {
  const over = {};
  for (const [id, c] of Object.entries(d.cats)) {
    const base = d.dev[c.d] && d.dev[c.d].cats && d.dev[c.d].cats[id];
    if (c.st !== 'a' || c.m || !base || c.n !== base.n || c.r !== base.r || c.i !== base.i) {
      over[id] = { n: c.n, r: c.r, i: c.i, st: c.st, m: c.m };
    }
  }
  return { config: d.config, over };
}

// Aplica un cambio sobre los datos más recientes y publica lo que cambió.
async function guardar(aplicar) {
  const d = await leerDoc();
  const antesDev = JSON.stringify(contenidoDispositivo(d));
  const antesCfg = JSON.stringify(contenidoConfig(d));
  aplicar(d);
  const dev = contenidoDispositivo(d);
  if (JSON.stringify(dev) !== antesDev) {
    eventosPropios.dev = await publicarEvento(claveDispositivo, D_DEV, dev, eventosPropios.dev);
    d.dev[DISPOSITIVO] = { ...(d.dev[DISPOSITIVO] || {}), cats: dev.cats };
  }
  const cfg = contenidoConfig(d);
  if (JSON.stringify(cfg) !== antesCfg) {
    if (!esAdmin) throw new Error('Solo el organizador puede hacer esto.');
    eventoConfig = await publicarEvento(CLAVE_ADMIN, D_CONFIG, cfg, eventoConfig);
  }
  doc = d;
}

function miDev(d) {
  d.dev[DISPOSITIVO] = d.dev[DISPOSITIVO] || {};
  const m = d.dev[DISPOSITIVO];
  m.v1 = m.v1 || {};
  m.nom = m.nom || {};
  m.v3 = m.v3 || {};
  m.v3d = m.v3d || {};
  m.rep = m.rep || {};
  return m;
}

async function crearConcurso() {
  const clave = N.utils.bytesToHex(N.generateSecretKey());
  const sala = N.getPublicKey(N.utils.hexToBytes(clave));
  const ahora = Date.now();
  const dia = 86400000;
  const iso = (ms) => new Date(ms).toISOString();
  const config = {
    f1s: iso(ahora), f1e: iso(ahora + 21 * dia),
    f2s: iso(ahora + 21 * dia), f2e: iso(ahora + 28 * dia),
    f3s: iso(ahora + 28 * dia), f3e: iso(ahora + 35 * dia),
    publicado: false, desempate: null,
  };
  await publicarEvento(clave, `dundies:${sala}:config`, { config, over: {} }, null);
  guardarLocal('dundies_admin_' + sala, clave);
  if (leerLocal('dundies_admin_' + sala) !== clave) {
    throw new Error('Este navegador no permite guardar datos (¿modo incógnito?). Use una ventana normal.');
  }
  location.href = location.pathname + '?sala=' + sala + '#/admin';
}

// ------------------------------------------------------------------
// Cálculos (todo sale del documento compartido)
// ------------------------------------------------------------------
function fase(d = doc) {
  const c = d.config;
  const t = Date.now();
  if (c.publicado) return 'ganadores';
  if (t < Date.parse(c.f1s)) return 'espera';
  if (t < Date.parse(c.f1e)) return 'categorias';
  if (!oficialesListas(d)) return 'desempate';
  if (t < Date.parse(c.f2s)) return 'pausa_1_2';
  if (t < Date.parse(c.f2e)) return 'nominaciones';
  if (t < Date.parse(c.f3s)) return 'pausa_2_3';
  if (t < Date.parse(c.f3e)) return 'final';
  return 'resultados_pendientes';
}

// Categoría activa a la que apunta un id (sigue las fusiones).
function destino(d, id) {
  let c = d.cats[id];
  let vueltas = 0;
  while (c && c.st === 'm' && c.m && vueltas++ < 20) { id = c.m; c = d.cats[id]; }
  return c && c.st === 'a' ? id : null;
}

function activas(d = doc) {
  return Object.entries(d.cats).filter(([, c]) => c.st === 'a').map(([id, c]) => ({ id, ...c }));
}

// Votos de fase 1 por categoría (un dispositivo suma 1 por categoría por día).
function votosCategorias(d = doc) {
  const cuenta = {};
  for (const m of Object.values(d.dev)) {
    for (const lista of Object.values(m.v1 || {})) {
      const vistos = new Set();
      for (const id of lista) {
        const dst = destino(d, id);
        if (dst && !vistos.has(dst)) { vistos.add(dst); cuenta[dst] = (cuenta[dst] || 0) + 1; }
      }
    }
  }
  return cuenta;
}

function misVotosHoy(d = doc) {
  const m = d.dev[DISPOSITIVO];
  const lista = (m && m.v1 && m.v1[hoy()]) || [];
  return [...new Set(lista.map((id) => destino(d, id)).filter(Boolean))];
}

function misPropuestas(d = doc) {
  return Object.values(d.cats).filter((c) => c.d === DISPOSITIVO).length;
}

function ranking(d = doc) {
  const v = votosCategorias(d);
  return activas(d).map((c) => ({ ...c, votos: v[c.id] || 0 }))
    .sort((a, b) => (b.votos - a.votos) || (Date.parse(a.t) - Date.parse(b.t)));
}

// Cierre de fase 1: oficiales seguras y empate pendiente en el último puesto.
function cierreFase1(d = doc) {
  const r = ranking(d);
  const K = LIMITES.oficiales;
  if (r.length <= K) return { seguras: r, empatadas: [], cupos: 0 };
  const corte = r[K - 1].votos;
  const seguras = r.filter((c) => c.votos > corte);
  const empatadas = r.filter((c) => c.votos === corte);
  if (seguras.length + empatadas.length === K) return { seguras: seguras.concat(empatadas), empatadas: [], cupos: 0 };
  return { seguras, empatadas, cupos: K - seguras.length };
}

function oficialesListas(d = doc) {
  const { empatadas, cupos } = cierreFase1(d);
  if (!cupos) return true;
  const elegidas = (d.config.desempate || []).filter((id) => empatadas.some((c) => c.id === id));
  return elegidas.length === cupos;
}

function oficiales(d = doc) {
  if (Date.now() < Date.parse(d.config.f1e)) return [];
  const { seguras, empatadas, cupos } = cierreFase1(d);
  if (!cupos) return seguras;
  const elegidas = empatadas.filter((c) => (d.config.desempate || []).includes(c.id));
  return elegidas.length === cupos ? seguras.concat(elegidas) : [];
}

// Nominaciones de una categoría: nombre normalizado → nombre más usado y cantidad.
function nominaciones(d, catId) {
  const cuenta = {};
  for (const m of Object.values(d.dev)) {
    const nombre = m.nom && m.nom[catId];
    if (!nombre) continue;
    const k = norm(nombre);
    if (!k) continue;
    cuenta[k] = cuenta[k] || { clave: k, n: 0, grafias: {} };
    cuenta[k].n++;
    cuenta[k].grafias[nombre] = (cuenta[k].grafias[nombre] || 0) + 1;
  }
  return Object.values(cuenta).map((x) => ({
    clave: x.clave, n: x.n,
    nombre: Object.entries(x.grafias).sort((a, b) => b[1] - a[1])[0][0],
  })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));
}

// Finalistas: los 3 más nominados (si hay empate en el 3.er lugar, pasan todos).
function finalistas(d, catId) {
  if (Date.now() < Date.parse(d.config.f2e)) return [];
  const lista = nominaciones(d, catId);
  if (!lista.length) return [];
  const corte = lista[Math.min(LIMITES.finalistas, lista.length) - 1].n;
  return lista.filter((x) => x.n >= corte);
}

function resultados(d = doc) {
  return oficiales(d).map((c) => {
    const fin = finalistas(d, c.id);
    const votos = {};
    for (const m of Object.values(d.dev)) {
      const k = m.v3 && m.v3[c.id];
      if (k && fin.some((f) => f.clave === k)) votos[k] = (votos[k] || 0) + 1;
    }
    const max = Math.max(0, ...Object.values(votos));
    const lista = fin.map((f) => ({ ...f, votos: votos[f.clave] || 0, gana: max > 0 && (votos[f.clave] || 0) === max }));
    return { cat: c, lista, ganadores: lista.filter((f) => f.gana) };
  });
}

function votosFinalesHoy(d = doc) {
  const m = d.dev[DISPOSITIVO];
  return (m && m.v3d && m.v3d[hoy()]) || 0;
}

// ------------------------------------------------------------------
// Fases: textos y cuenta regresiva
// ------------------------------------------------------------------
function infoFase() {
  const c = doc.config;
  switch (fase()) {
    case 'espera': return { titulo: 'Muy pronto', texto: 'La propuesta de categorías empieza en:', meta: c.f1s };
    case 'categorias': return { titulo: 'Fase 1 · Categorías', texto: 'Proponga categorías y vote por sus favoritas. Cierra en:', meta: c.f1e, cta: ['#/categorias', 'Ir a las categorías'] };
    case 'desempate': return { titulo: 'Fase 1 cerrada', texto: 'Hubo un empate en el último puesto. El organizador está eligiendo las categorías oficiales.' };
    case 'pausa_1_2': return { titulo: '¡Ya hay categorías oficiales!', texto: 'Las nominaciones empiezan en:', meta: c.f2s, cta: ['#/categorias', 'Ver las oficiales'] };
    case 'nominaciones': return { titulo: 'Fase 2 · Nominaciones', texto: 'Nomine a una persona en cada categoría oficial. Cierra en:', meta: c.f2e, cta: ['#/nominar', 'Nominar'] };
    case 'pausa_2_3': return { titulo: '¡Ya hay finalistas!', texto: 'La votación final empieza en:', meta: c.f3s };
    case 'final': return { titulo: 'Fase 3 · Votación final', texto: 'Vote por su favorito en cada categoría. Cierra en:', meta: c.f3e, cta: ['#/votar', 'Votar'] };
    case 'resultados_pendientes': return { titulo: 'Votación cerrada', texto: 'Los ganadores se anunciarán muy pronto. ¡Atentos!' };
    case 'ganadores': return { titulo: '¡Tenemos ganadores!', texto: 'Ya se publicaron los Premios Dundies.', cta: ['#/ganadores', 'Ver ganadores'] };
    default: return { titulo: '', texto: '' };
  }
}

let timer = null;
function htmlCuenta(meta) {
  if (!meta) return '';
  return `<div class="cuenta" id="cuenta" data-meta="${esc(meta)}">
    <div class="caja"><span class="num" data-u="d">--</span><span class="lbl">días</span></div>
    <div class="caja"><span class="num" data-u="h">--</span><span class="lbl">horas</span></div>
    <div class="caja"><span class="num" data-u="m">--</span><span class="lbl">min</span></div>
    <div class="caja"><span class="num" data-u="s">--</span><span class="lbl">seg</span></div>
  </div><p class="centro suave" style="font-size:.85rem">${esc(fecha(meta))}</p>`;
}
function arrancarCuenta() {
  const el = document.getElementById('cuenta');
  if (!el) return;
  const meta = Date.parse(el.dataset.meta);
  const pintar = () => {
    let ms = meta - Date.now();
    if (ms <= 0) { clearInterval(timer); setTimeout(render, 1500); ms = 0; }
    const s = Math.floor(ms / 1000);
    const v = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
    for (const k in v) el.querySelector(`[data-u="${k}"]`).textContent = String(v[k]).padStart(2, '0');
  };
  pintar();
  timer = setInterval(pintar, 1000);
}

// ------------------------------------------------------------------
// Navegación
// ------------------------------------------------------------------
function rutaActual() {
  const h = location.hash;
  return h.startsWith('#/') ? h.slice(2).split('?')[0] : '';
}
function pintarNav() {
  const r = rutaActual();
  const link = (ruta, txt) => `<a href="#/${ruta}" class="${r === ruta ? 'activo' : ''}">${txt}</a>`;
  let html = link('', 'Inicio') + link('categorias', 'Categorías') + link('nominar', 'Nominar') + link('votar', 'Votar') + link('ganadores', 'Ganadores');
  if (esAdmin) html += link('admin', 'Organizador');
  $nav.innerHTML = `<div class="fila">${html}</div>`;
}

const RUTAS = { '': pInicio, categorias: pCategorias, nominar: pNominar, votar: pVotar, ganadores: pGanadores, admin: pAdmin };

// Dibuja la página de la ruta actual. Si llega otro pedido mientras dibuja,
// vuelve a dibujar al terminar, así siempre gana la última ruta.
let dibujando = false;
let pendiente = false;
async function render() {
  if (dibujando) { pendiente = true; return; }
  dibujando = true;
  try {
    do { pendiente = false; await renderUnaVez(); } while (pendiente);
  } finally { dibujando = false; }
}
async function renderUnaVez() {
  clearInterval(timer);
  try {
    doc = await leerDoc();
  } catch (e) {
    $nav.innerHTML = '';
    $app.innerHTML = `<div class="panel">${aviso(e.message)}<button class="boton" onclick="location.reload()">Reintentar</button></div>`;
    return;
  }
  pintarNav();
  try {
    (RUTAS[rutaActual()] || pInicio)();
  } catch (e) {
    $app.innerHTML = aviso(e.message);
  }
  arrancarCuenta();
}

// ------------------------------------------------------------------
// Tarjeta
// ------------------------------------------------------------------
function htmlTarjeta(c, { cuerpo = '', para = '', sello = '', oficial = false } = {}) {
  return `<article class="tarjeta ${oficial ? 'oficial' : ''} ${c.st === 'h' ? 'oculta' : ''}" data-id="${esc(c.id)}">
    ${sello}
    <div class="icono">${ICONS[c.i] || '💧'}</div>
    <h3>${esc(c.n)}</h3>
    <p class="porque"><b>Porque</b> ${esc(c.r)}</p>
    <p class="para">Para: <span class="linea">${para ? esc(para) : '&nbsp;'}</span></p>
    ${cuerpo}
    ${GOTA}${OLA}
  </article>`;
}
function htmlSelectorIconos(elegido) {
  return `<div class="iconos" id="iconos">${Object.entries(ICONS).map(([k, v]) =>
    `<button type="button" data-icon="${k}" class="${k === elegido ? 'elegido' : ''}" aria-label="${k}">${v}</button>`).join('')}</div>`;
}
function activarSelectorIconos(raiz, alElegir) {
  raiz.querySelectorAll('#iconos button').forEach((b) => {
    b.onclick = () => {
      raiz.querySelectorAll('#iconos button').forEach((x) => x.classList.remove('elegido'));
      b.classList.add('elegido');
      alElegir(b.dataset.icon);
    };
  });
}
function buscarParecidas(nombre, lista) {
  const n = norm(nombre);
  if (n.length < 3) return { igual: null, parecidas: [] };
  const igual = lista.find((c) => norm(c.n) === n) || null;
  const palabras = n.split(' ').filter((w) => w.length > 3);
  const parecidas = lista.filter((c) => {
    if (c === igual) return false;
    const cn = norm(c.n);
    return cn.includes(n) || n.includes(cn) || (palabras.length > 0 && palabras.filter((w) => cn.includes(w)).length >= Math.min(2, palabras.length));
  }).slice(0, 3);
  return { igual, parecidas };
}

// ------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------
function pInicio() {
  const f = infoFase();
  let html = `<h2 class="seccion">${esc(f.titulo)}</h2><p class="centro fase-actual">${esc(f.texto)}</p>${htmlCuenta(f.meta)}`;
  if (fase() === 'categorias') {
    html += `<div class="chips"><span class="chip">Le quedan ${Math.max(0, LIMITES.propuestas - misPropuestas())} propuestas</span>
      <span class="chip">Le quedan ${Math.max(0, LIMITES.votosDia - misVotosHoy().length)} votos hoy</span></div>`;
  }
  if (f.cta) html += `<p class="centro"><a class="boton" href="${f.cta[0]}">${esc(f.cta[1])}</a></p>`;
  const c = doc.config;
  html += `<div class="panel ancho"><h2>¿Cómo funciona?</h2>
    <p>No hace falta registrarse. Cada celular o computadora puede dar <b>${LIMITES.votosDia} votos por día</b>.</p>
    <p><b>1. Categorías</b> (${esc(fecha(c.f1s))} – ${esc(fecha(c.f1e))}): proponga hasta ${LIMITES.propuestas} categorías y vote por sus favoritas. Las ${LIMITES.oficiales} más votadas quedan oficiales.</p>
    <p><b>2. Nominaciones</b> (${esc(fecha(c.f2s))} – ${esc(fecha(c.f2e))}): escriba el nombre de una persona en cada categoría oficial. Los ${LIMITES.finalistas} más nominados pasan a la final.</p>
    <p><b>3. Votación final</b> (${esc(fecha(c.f3s))} – ${esc(fecha(c.f3e))}): un voto por categoría desde cada dispositivo.</p>
    <p><b>4. Ganadores</b>: se publican al final, con una tarjeta descargable para cada ganador.</p></div>`;
  $app.innerHTML = html;
}

// ------------------------------------------------------------------
// Fase 1: categorías
// ------------------------------------------------------------------
let filtro = { texto: '', orden: 'votos' };

function pCategorias() {
  const fa = fase();
  const abierta = fa === 'categorias';
  let html = `<h2 class="seccion">Categorías</h2><p class="centro fase-actual">${esc(infoFase().texto)}</p>${abierta ? htmlCuenta(doc.config.f1e) : ''}`;
  if (abierta) {
    html += '<div class="chips" id="chips"></div>';
    html += misPropuestas() < LIMITES.propuestas ? `<form class="panel ancho" id="fprop">
      <h2>Proponer una categoría</h2>
      <label for="nombre">Nombre de la categoría</label>
      <input id="nombre" maxlength="60" required minlength="3" placeholder="Ej. El más cafetero">
      <div id="dup"></div>
      <label for="porque">Frase corta</label>
      <div class="porque-input"><span>Porque…</span><input id="porque" maxlength="140" minlength="3" required placeholder="nunca suelta la taza"></div>
      <label>Ícono</label>${htmlSelectorIconos('gota')}
      <div class="botones"><button class="boton" type="submit">Proponer</button></div>
    </form>` : `<div class="panel">${aviso(`Ya usó sus ${LIMITES.propuestas} propuestas en este dispositivo. Todavía puede votar.`, 'alerta')}</div>`;
  } else if (fa === 'espera') {
    html += '<p class="centro">La fase 1 todavía no empieza.</p>';
  }
  html += `<div class="barra"><input id="buscar" type="search" placeholder="Buscar categoría…" value="${esc(filtro.texto)}">
    <select id="orden"><option value="votos">Más votadas</option><option value="nuevas">Más nuevas</option><option value="az">A–Z</option></select></div>
    <div class="rejilla" id="rejilla"></div>`;
  $app.innerHTML = html;

  document.getElementById('orden').value = filtro.orden;
  document.getElementById('buscar').oninput = (e) => { filtro.texto = e.target.value; pintarRejilla(); };
  document.getElementById('orden').onchange = (e) => { filtro.orden = e.target.value; pintarRejilla(); };
  pintarRejilla();

  const fp = document.getElementById('fprop');
  if (!fp) return;
  let icono = 'gota';
  activarSelectorIconos(fp, (i) => { icono = i; });
  fp.nombre.oninput = () => {
    const { igual, parecidas } = buscarParecidas(fp.nombre.value, activas());
    const d = document.getElementById('dup');
    if (igual) d.innerHTML = aviso(`Ya existe "${igual.n}". Mejor vote por esa.`);
    else if (parecidas.length) d.innerHTML = aviso(`Se parece a: ${parecidas.map((c) => `"${c.n}"`).join(', ')}. ¿Seguro que es distinta?`, 'alerta');
    else d.innerHTML = '';
  };
  fp.onsubmit = (e) => {
    e.preventDefault();
    const nombre = fp.nombre.value.trim();
    const porque = fp.porque.value.trim().replace(/^porque\s*/i, '');
    if (nombre.length < 3 || porque.length < 3) { toast('Complete el nombre y la frase.', true); return; }
    const id = DISPOSITIVO.slice(0, 10) + '-' + idAleatorio(6);
    accion(fp.querySelector('button[type=submit]'), async () => {
      await guardar((d) => {
        if (d.cats[id]) return;
        if (fase(d) !== 'categorias') throw new Error('La fase de categorías ya cerró.');
        if (misPropuestas(d) >= LIMITES.propuestas) throw new Error(`Ya usó sus ${LIMITES.propuestas} propuestas.`);
        const igual = activas(d).find((c) => norm(c.n) === norm(nombre));
        if (igual) throw new Error(`Ya existe "${igual.n}". Mejor vote por esa.`);
        d.cats[id] = { n: nombre, r: porque, i: icono, d: DISPOSITIVO, t: new Date().toISOString(), st: 'a' };
      }, (d) => !!d.cats[id]);
      render();
    }, '¡Categoría propuesta!');
  };
}

function pintarRejilla() {
  const abierta = fase() === 'categorias';
  const quedan = LIMITES.votosDia - misVotosHoy().length;
  const chips = document.getElementById('chips');
  if (chips) {
    chips.innerHTML = `<span class="chip">Le quedan ${Math.max(0, LIMITES.propuestas - misPropuestas())} propuestas</span>
      <span class="chip">Le quedan ${Math.max(0, quedan)} votos hoy</span>`;
  }
  const votadasHoy = new Set(misVotosHoy());
  const reportadas = (doc.dev[DISPOSITIVO] && doc.dev[DISPOSITIVO].rep) || {};
  const fase1Cerrada = Date.now() >= Date.parse(doc.config.f1e);
  const ofi = new Set(oficiales().map((c) => c.id));
  const cierre = fase1Cerrada ? cierreFase1() : null;
  const empatadas = new Set(cierre && cierre.cupos && !oficialesListas() ? cierre.empatadas.map((c) => c.id) : []);

  let lista = ranking();
  if (esAdmin) {
    lista = lista.concat(Object.entries(doc.cats).filter(([, c]) => c.st === 'h').map(([id, c]) => ({ id, ...c, votos: 0 })));
  }
  if (fase1Cerrada && !esAdmin) lista = lista.filter((c) => ofi.has(c.id) || empatadas.has(c.id));
  const t = norm(filtro.texto);
  if (t) lista = lista.filter((c) => norm(c.n + ' ' + c.r).includes(t));
  if (filtro.orden === 'nuevas') lista.sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  if (filtro.orden === 'az') lista.sort((a, b) => a.n.localeCompare(b.n, 'es'));
  if (filtro.orden === 'votos') lista.sort((a, b) => (ofi.has(b.id) - ofi.has(a.id)) || (b.votos - a.votos));

  const rej = document.getElementById('rejilla');
  if (!lista.length) { rej.innerHTML = '<p class="centro suave">Todavía no hay categorías. ¡Proponga la primera!</p>'; return; }
  const reportes = {};
  if (esAdmin) for (const m of Object.values(doc.dev)) for (const id of Object.keys(m.rep || {})) reportes[id] = (reportes[id] || 0) + 1;

  rej.innerHTML = lista.map((c) => {
    let sello = '';
    if (c.st === 'h') sello = '<span class="sello oculta">Oculta</span>';
    else if (ofi.has(c.id)) sello = '<span class="sello">Oficial</span>';
    else if (empatadas.has(c.id)) sello = '<span class="sello empate">Empate</span>';
    let cuerpo = `<p class="autor">${c.d === DISPOSITIVO ? 'Propuesta desde este dispositivo' : '&nbsp;'}</p><div class="acciones">`;
    if (abierta && c.st === 'a') {
      cuerpo += votadasHoy.has(c.id)
        ? '<button class="boton votado" data-act="quitar">✓ Votada hoy · quitar</button>'
        : `<button class="boton" data-act="votar" ${quedan <= 0 ? 'disabled title="Ya usó sus votos de hoy"' : ''}>Votar</button>`;
    }
    if (c.st === 'a' && !reportadas[c.id]) cuerpo += '<button class="boton secundario" data-act="reportar" title="Reportar">⚑</button>';
    cuerpo += `<span class="contador-votos">${c.votos} ${c.votos === 1 ? 'voto' : 'votos'}</span></div>`;
    if (esAdmin) {
      cuerpo += `<div class="admin-fila">
        ${reportes[c.id] ? `<span class="sello empate" style="position:static">${reportes[c.id]} reporte(s)</span>` : ''}
        <button class="boton mini secundario" data-act="editar">Editar</button>
        ${!fase1Cerrada ? (c.st === 'a'
          ? '<button class="boton mini secundario" data-act="fusionar">Fusionar</button><button class="boton mini peligro" data-act="ocultar">Ocultar</button>'
          : '<button class="boton mini secundario" data-act="mostrar">Mostrar</button>') : ''}
      </div>`;
    }
    return htmlTarjeta(c, { cuerpo, sello, oficial: ofi.has(c.id) });
  }).join('');

  rej.querySelectorAll('[data-act]').forEach((b) => {
    const id = b.closest('.tarjeta').dataset.id;
    b.onclick = () => accionCategoria(b, b.dataset.act, { id, ...doc.cats[id] });
  });
}

async function accionCategoria(btn, act, c) {
  const dia = hoy();
  if (act === 'votar') {
    return accion(btn, async () => {
      await guardar((d) => {
        if (fase(d) !== 'categorias') throw new Error('La votación de categorías ya cerró.');
        if (!destino(d, c.id)) throw new Error('Esa categoría ya no está disponible.');
        const hoyLista = misVotosHoy(d);
        if (hoyLista.includes(c.id)) return;
        if (hoyLista.length >= LIMITES.votosDia) throw new Error(`Ya usó sus ${LIMITES.votosDia} votos de hoy. Vuelva mañana.`);
        const m = miDev(d);
        m.v1[dia] = (m.v1[dia] || []).concat(c.id);
      }, (d) => misVotosHoy(d).includes(c.id));
      pintarRejilla();
    }, '¡Voto registrado!');
  }
  if (act === 'quitar') {
    return accion(btn, async () => {
      await guardar((d) => {
        if (fase(d) !== 'categorias') throw new Error('La fase ya cerró: los votos no se pueden cambiar.');
        const m = miDev(d);
        m.v1[dia] = (m.v1[dia] || []).filter((id) => destino(d, id) !== c.id);
      }, (d) => !misVotosHoy(d).includes(c.id));
      pintarRejilla();
    }, 'Voto quitado.');
  }
  if (act === 'reportar') {
    const motivo = prompt(`¿Por qué reporta "${c.n}"? (opcional)`);
    if (motivo === null) return;
    return accion(btn, async () => {
      await guardar((d) => { miDev(d).rep[c.id] = (motivo || 'sin motivo').slice(0, 200); },
        (d) => !!(d.dev[DISPOSITIVO] && d.dev[DISPOSITIVO].rep && d.dev[DISPOSITIVO].rep[c.id]));
      pintarRejilla();
    }, 'Gracias. El organizador lo revisará.');
  }
  if (act === 'ocultar') {
    if (!confirm(`¿Ocultar "${c.n}"?\n\nSus votos dejan de contar y quienes la votaron hoy recuperan ese voto.`)) return;
    return accion(btn, async () => {
      await guardar((d) => { if (d.cats[c.id]) d.cats[c.id].st = 'h'; }, (d) => d.cats[c.id] && d.cats[c.id].st === 'h');
      render();
    }, 'Categoría oculta.');
  }
  if (act === 'mostrar') {
    return accion(btn, async () => {
      await guardar((d) => {
        if (d.cats[c.id].st === 'a') return;
        const igual = activas(d).find((x) => norm(x.n) === norm(c.n));
        if (igual) throw new Error(`Ya hay otra categoría activa llamada "${igual.n}".`);
        d.cats[c.id].st = 'a';
      }, (d) => d.cats[c.id] && d.cats[c.id].st === 'a');
      render();
    }, 'Categoría visible de nuevo.');
  }
  if (act === 'editar') return modalEditar(c);
  if (act === 'fusionar') return modalFusionar(c);
}

function modalEditar(c) {
  $modal.innerHTML = `<form class="panel" id="fe">
    <h2>Editar categoría</h2>
    <label for="nombre">Nombre</label><input id="nombre" maxlength="60" minlength="3" required value="${esc(c.n)}">
    <label for="porque">Porque…</label><input id="porque" maxlength="140" minlength="3" required value="${esc(c.r)}">
    <label>Ícono</label>${htmlSelectorIconos(c.i)}
    <div class="botones"><button class="boton" type="submit">Guardar</button><button class="boton secundario" style="color:#fff" type="button" id="cancelar">Cancelar</button></div>
  </form>`;
  const fe = document.getElementById('fe');
  let icono = c.i;
  activarSelectorIconos(fe, (i) => { icono = i; });
  document.getElementById('cancelar').onclick = () => $modal.close();
  fe.onsubmit = (e) => {
    e.preventDefault();
    const n = fe.nombre.value.trim();
    const r = fe.porque.value.trim();
    accion(fe.querySelector('button[type=submit]'), async () => {
      await guardar((d) => {
        const igual = activas(d).find((x) => x.id !== c.id && norm(x.n) === norm(n));
        if (igual) throw new Error(`Ya hay otra categoría llamada "${igual.n}".`);
        Object.assign(d.cats[c.id], { n, r, i: icono });
      }, (d) => d.cats[c.id] && d.cats[c.id].n === n && d.cats[c.id].r === r && d.cats[c.id].i === icono);
      $modal.close();
      render();
    }, 'Categoría actualizada.');
  };
  $modal.showModal();
}

function modalFusionar(c) {
  const otras = activas().filter((x) => x.id !== c.id).sort((a, b) => a.n.localeCompare(b.n, 'es'));
  $modal.innerHTML = `<form class="panel" id="ff">
    <h2>Fusionar categoría</h2>
    <p>"<b>${esc(c.n)}</b>" desaparece y sus votos pasan a la categoría que elija. Si un dispositivo votó por las dos el mismo día, cuenta una sola vez.</p>
    <label for="destino">Pasar a:</label>
    <select id="destino" required><option value="">— Elija —</option>${otras.map((x) => `<option value="${esc(x.id)}">${esc(x.n)}</option>`).join('')}</select>
    <div class="botones"><button class="boton" type="submit">Fusionar</button><button class="boton secundario" style="color:#fff" type="button" id="cancelar">Cancelar</button></div>
  </form>`;
  const ff = document.getElementById('ff');
  document.getElementById('cancelar').onclick = () => $modal.close();
  ff.onsubmit = (e) => {
    e.preventDefault();
    const hacia = ff.destino.value;
    accion(ff.querySelector('button[type=submit]'), async () => {
      await guardar((d) => {
        if (d.cats[c.id].st === 'm') return;
        if (!d.cats[hacia] || d.cats[hacia].st !== 'a') throw new Error('La categoría de destino ya no está activa.');
        Object.assign(d.cats[c.id], { st: 'm', m: hacia });
      }, (d) => d.cats[c.id] && d.cats[c.id].st === 'm');
      $modal.close();
      render();
    }, 'Categorías fusionadas.');
  };
  $modal.showModal();
}

// ------------------------------------------------------------------
// Fase 2: nominaciones
// ------------------------------------------------------------------
function pNominar() {
  const fa = fase();
  const ofi = oficiales();
  if (!ofi.length) {
    $app.innerHTML = '<h2 class="seccion">Nominaciones</h2><p class="centro">Las nominaciones empiezan cuando estén listas las categorías oficiales.</p>';
    return;
  }
  const abierta = fa === 'nominaciones';
  const mias = (doc.dev[DISPOSITIVO] && doc.dev[DISPOSITIVO].nom) || {};
  const hechas = ofi.filter((c) => mias[c.id]).length;
  // Nombres ya usados por otros, para que se escriban igual y los votos se sumen.
  const nombres = new Set();
  for (const m of Object.values(doc.dev)) for (const n of Object.values(m.nom || {})) nombres.add(n);

  let html = `<h2 class="seccion">Nominaciones</h2>
    <p class="centro fase-actual">${esc(abierta ? infoFase().texto : fa === 'pausa_1_2' ? 'Las nominaciones todavía no empiezan.' : 'Las nominaciones están cerradas.')}</p>`;
  if (abierta) html += htmlCuenta(doc.config.f2e);
  html += `<div class="chips"><span class="chip">Nominó en ${hechas} de ${ofi.length} categorías</span></div>
    <p class="centro suave">Escriba nombre y apellido de una persona en cada categoría. Si ya aparece en la lista, elíjalo tal cual para que los votos se sumen. Puede cambiarlo mientras la fase esté abierta.</p>
    <datalist id="personas">${[...nombres].sort((a, b) => a.localeCompare(b, 'es')).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="rejilla">`;
  html += ofi.map((c) => {
    const cuerpo = abierta
      ? `<form class="campo" data-cat="${esc(c.id)}"><input list="personas" maxlength="50" placeholder="Nombre y apellido" value="${esc(mias[c.id] || '')}" aria-label="Nominar en ${esc(c.n)}">
          <div class="acciones"><button class="boton" type="submit">Guardar</button>${mias[c.id] ? '<button class="boton secundario" type="button" data-quitar>Quitar</button>' : ''}</div></form>`
      : '';
    return htmlTarjeta(c, { cuerpo, para: mias[c.id] || '', oficial: true });
  }).join('');
  html += '</div>';
  $app.innerHTML = html;

  $app.querySelectorAll('form[data-cat]').forEach((f) => {
    const catId = f.dataset.cat;
    const enviar = (valor) => accion(f.querySelector('button'), async () => {
      await guardar((d) => {
        if (fase(d) !== 'nominaciones') throw new Error('Las nominaciones ya cerraron.');
        const m = miDev(d);
        if (valor) m.nom[catId] = valor; else delete m.nom[catId];
      }, (d) => ((d.dev[DISPOSITIVO] && d.dev[DISPOSITIVO].nom && d.dev[DISPOSITIVO].nom[catId]) || '') === valor);
      render();
    }, valor ? 'Nominación guardada.' : 'Nominación quitada.');
    f.onsubmit = (e) => {
      e.preventDefault();
      const valor = f.querySelector('input').value.trim().replace(/\s+/g, ' ');
      if (valor.length < 2) { toast('Escriba un nombre.', true); return; }
      enviar(valor);
    };
    const q = f.querySelector('[data-quitar]');
    if (q) q.onclick = () => enviar('');
  });
}

// ------------------------------------------------------------------
// Fase 3: votación final
// ------------------------------------------------------------------
function pVotar() {
  const fa = fase();
  const conFinal = oficiales().map((c) => ({ c, fin: finalistas(doc, c.id) })).filter((x) => x.fin.length);
  if (!conFinal.length) {
    $app.innerHTML = '<h2 class="seccion">Votación final</h2><p class="centro">La votación final empieza cuando estén listos los finalistas.</p>';
    return;
  }
  const abierta = fa === 'final';
  const mios = (doc.dev[DISPOSITIVO] && doc.dev[DISPOSITIVO].v3) || {};
  const quedan = LIMITES.votosDia - votosFinalesHoy();
  let html = `<h2 class="seccion">Votación final</h2>
    <p class="centro fase-actual">${esc(abierta ? infoFase().texto : fa === 'pausa_2_3' ? 'La votación final todavía no empieza.' : 'La votación final está cerrada.')}</p>`;
  if (abierta) html += htmlCuenta(doc.config.f3e);
  html += `<div class="chips"><span class="chip">Votó en ${conFinal.filter((x) => mios[x.c.id]).length} de ${conFinal.length} categorías</span>
    ${abierta ? `<span class="chip">Le quedan ${Math.max(0, quedan)} votos hoy</span>` : ''}</div>
    <p class="centro suave">Un voto por categoría desde este dispositivo, hasta ${LIMITES.votosDia} por día. Una vez enviado <b>no se puede cambiar</b>.</p>`;
  if (abierta && quedan <= 0) html += aviso(`Ya usó sus ${LIMITES.votosDia} votos de hoy. Vuelva mañana para votar en las demás categorías.`, 'alerta');
  html += '<div class="rejilla">';
  html += conFinal.map(({ c, fin }) => {
    const elegido = mios[c.id] && fin.find((f) => f.clave === mios[c.id]);
    let cuerpo;
    if (mios[c.id]) cuerpo = `<p class="listo">✓ Ya votó${elegido ? ' por ' + esc(elegido.nombre) : ''}.</p>`;
    else if (!abierta) cuerpo = `<p class="autor">Finalistas: ${fin.map((f) => esc(f.nombre)).join(', ')}</p>`;
    else {
      cuerpo = fin.map((f) => `<label class="opcion"><input type="radio" name="c${esc(c.id)}" value="${esc(f.clave)}"> ${esc(f.nombre)}</label>`).join('') +
        `<div class="acciones"><button class="boton" data-votar="${esc(c.id)}" ${quedan <= 0 ? 'disabled title="Ya usó sus votos de hoy"' : ''}>Votar</button></div>`;
    }
    return htmlTarjeta(c, { cuerpo, oficial: true });
  }).join('');
  html += '</div>';
  $app.innerHTML = html;

  $app.querySelectorAll('[data-votar]').forEach((b) => {
    b.onclick = () => {
      const catId = b.dataset.votar;
      const radio = $app.querySelector(`input[name="c${CSS.escape(catId)}"]:checked`);
      if (!radio) { toast('Primero elija a una persona.', true); return; }
      const nombre = radio.parentElement.textContent.trim();
      if (!confirm(`¿Votar por ${nombre} en "${doc.cats[catId].n}"?\n\nNo se puede cambiar.`)) return;
      const dia = hoy();
      accion(b, async () => {
        await guardar((d) => {
          const m = miDev(d);
          if (m.v3[catId]) return;
          if (fase(d) !== 'final') throw new Error('La votación final no está abierta.');
          if ((m.v3d[dia] || 0) >= LIMITES.votosDia) throw new Error(`Ya usó sus ${LIMITES.votosDia} votos de hoy. Vuelva mañana.`);
          m.v3[catId] = radio.value;
          m.v3d[dia] = (m.v3d[dia] || 0) + 1;
        }, (d) => !!(d.dev[DISPOSITIVO] && d.dev[DISPOSITIVO].v3 && d.dev[DISPOSITIVO].v3[catId]));
        render();
      }, '¡Voto registrado!');
    };
  });
}

// ------------------------------------------------------------------
// Fase 4: ganadores
// ------------------------------------------------------------------
function pGanadores() {
  const terminado = Date.now() >= Date.parse(doc.config.f3e);
  if (!doc.config.publicado) {
    let html = '<h2 class="seccion">Ganadores</h2><p class="centro">Los ganadores se publicarán cuando termine la votación final.</p>';
    if (esAdmin && terminado) {
      const res = resultados();
      html += `<div class="panel ancho"><h2>Vista previa (solo organizador)</h2>
        <table class="tabla"><tr><th>Categoría</th><th>Finalista</th><th>Votos</th></tr>
        ${res.map((r) => r.lista.map((f) => `<tr><td>${esc(r.cat.n)}</td><td>${f.gana ? '🏆 ' : ''}${esc(f.nombre)}</td><td>${f.votos}</td></tr>`).join('')).join('')}
        </table><div class="botones"><button class="boton" id="publicar">Publicar resultados</button></div></div>`;
    }
    $app.innerHTML = html;
    const p = document.getElementById('publicar');
    if (p) p.onclick = () => publicar(p, true);
    return;
  }
  const grupos = resultados().filter((r) => r.ganadores.length).map((r) => ({
    id: r.cat.id, name: r.cat.n, reason: r.cat.r, icon: r.cat.i, nombres: r.ganadores.map((g) => g.nombre),
  }));
  let html = '<h2 class="seccion">🏆 Ganadores 🏆</h2><p class="centro">¡Felicidades a todos los ganadores de los Premios Dundies!</p><div class="rejilla">';
  html += grupos.map((g, i) => `<div class="tarjeta-ganador-wrap">
      <div class="ganador-marco">
        <p class="mini-titulo">PREMIOS <b>DUNDIES</b></p>
        <p class="mini-sub">Dirección de Aguas</p>
        ${htmlTarjeta({ id: g.id, n: g.name, r: g.reason, i: g.icon, st: 'a' }, { para: g.nombres.join(' y '), sello: `<span class="sello">${g.nombres.length > 1 ? 'Ganadores' : 'Ganador'}</span>`, oficial: true })}
        <p class="lema">Porque el agua también nos une…</p>
      </div>
      <button class="boton" data-descargar="${i}">⬇ Descargar imagen</button>
    </div>`).join('');
  html += '</div>';
  if (!grupos.length) html += '<p class="centro">No hubo votos en la final.</p>';
  if (esAdmin) html += '<p class="centro"><button class="boton secundario" style="color:#fff" id="despublicar">Ocultar resultados otra vez</button></p>';
  $app.innerHTML = html;

  $app.querySelectorAll('[data-descargar]').forEach((b) => {
    b.onclick = () => accion(b, async () => {
      const g = grupos[Number(b.dataset.descargar)];
      const canvas = await dibujarTarjetaGanador(g);
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
      const a = document.createElement('a');
      a.download = `dundies-${norm(g.name).replace(/ /g, '-')}.png`;
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });
  });
  const d = document.getElementById('despublicar');
  if (d) d.onclick = () => publicar(d, false);
}

function publicar(boton, valor) {
  if (valor && !confirm('¿Publicar los resultados? Todos podrán ver a los ganadores.')) return;
  accion(boton, async () => {
    await guardar((d) => { d.config.publicado = valor; }, (d) => d.config.publicado === valor);
    render();
  }, valor ? '¡Resultados publicados!' : 'Resultados ocultos.');
}

// ------------------------------------------------------------------
// Panel del organizador
// ------------------------------------------------------------------
function pAdmin() {
  if (!esAdmin) { $app.innerHTML = aviso('Esta página es solo para el organizador.'); return; }
  const c = doc.config;
  let votos1 = 0;
  let noms = 0;
  let votos3 = 0;
  for (const m of Object.values(doc.dev)) {
    for (const l of Object.values(m.v1 || {})) votos1 += l.length;
    noms += Object.keys(m.nom || {}).length;
    votos3 += Object.keys(m.v3 || {}).length;
  }
  const reportes = [];
  for (const m of Object.values(doc.dev)) {
    for (const [id, motivo] of Object.entries(m.rep || {})) if (doc.cats[id] && doc.cats[id].st === 'a') reportes.push({ id, motivo });
  }
  const enlace = location.origin + location.pathname + '?sala=' + encodeURIComponent(SALA);
  const enlaceAdmin = enlace + '&admin=' + encodeURIComponent(CLAVE_ADMIN);
  const cierre = Date.now() >= Date.parse(c.f1e) ? cierreFase1() : null;

  let empateHtml = '';
  if (cierre && cierre.cupos) {
    empateHtml = `<div class="panel ancho"><h2>Desempate de la fase 1</h2>
      <p>Hay ${cierre.empatadas.length} categorías empatadas con ${cierre.empatadas[0].votos} votos. Elija <b>${cierre.cupos}</b> para completar las ${LIMITES.oficiales} oficiales:</p>
      <div id="empates">${cierre.empatadas.map((x) => `<label class="check"><input type="checkbox" value="${esc(x.id)}" ${(c.desempate || []).includes(x.id) ? 'checked' : ''}> ${ICONS[x.i] || ''} ${esc(x.n)}</label>`).join('')}</div>
      <button class="boton" id="desempatar">Confirmar elección</button></div>`;
  }

  $app.innerHTML = `<h2 class="seccion">Panel del organizador</h2>
    <div class="panel ancho"><h2>Enlaces</h2>
      <p><b>Para compartir con todos:</b></p><input readonly value="${esc(enlace)}" onclick="this.select()">
      <p style="margin-top:14px"><b>Su enlace de organizador</b> (guárdelo y no lo comparta; sirve para entrar como organizador desde otro dispositivo):</p>
      <input readonly value="${esc(enlaceAdmin)}" onclick="this.select()">
      <p class="ayuda">Código del concurso: <b>${esc(SALA)}</b></p>
    </div>
    <div class="panel ancho"><h2>Participación</h2><div class="stats">
      <div><b>${Object.keys(doc.dev).length}</b>dispositivos</div><div><b>${activas().length}</b>categorías</div>
      <div><b>${votos1}</b>votos fase 1</div><div><b>${noms}</b>nominaciones</div>
      <div><b>${votos3}</b>votos finales</div><div><b>${reportes.length}</b>reportes</div>
    </div><p class="suave">Fase actual: <b>${esc(infoFase().titulo)}</b></p>
    ${Date.now() >= Date.parse(c.f3e) ? `<div class="botones"><a class="boton" href="#/ganadores">${c.publicado ? 'Ver ganadores' : 'Revisar y publicar resultados'}</a></div>` : ''}
    </div>
    ${empateHtml}
    <form class="panel ancho" id="ffechas"><h2>Fechas</h2>
      <p class="suave">Hora de su dispositivo. Para cerrar una fase antes, adelante su fecha de cierre.</p>
      <div class="fechas">
        <div><label>Fase 1 empieza</label><input type="datetime-local" name="f1s" value="${toLocalInput(c.f1s)}" required></div>
        <div><label>Fase 1 termina</label><input type="datetime-local" name="f1e" value="${toLocalInput(c.f1e)}" required></div>
        <div><label>Fase 2 empieza</label><input type="datetime-local" name="f2s" value="${toLocalInput(c.f2s)}" required></div>
        <div><label>Fase 2 termina</label><input type="datetime-local" name="f2e" value="${toLocalInput(c.f2e)}" required></div>
        <div><label>Fase 3 empieza</label><input type="datetime-local" name="f3s" value="${toLocalInput(c.f3s)}" required></div>
        <div><label>Fase 3 termina</label><input type="datetime-local" name="f3e" value="${toLocalInput(c.f3e)}" required></div>
      </div>
      <button class="boton" type="submit">Guardar fechas</button>
    </form>
    <div class="panel ancho"><h2>Reportes (${reportes.length})</h2>
      ${reportes.length ? `<table class="tabla"><tr><th>Categoría</th><th>Motivo</th></tr>
        ${reportes.map((r) => `<tr><td>${esc(doc.cats[r.id].n)}</td><td>${esc(r.motivo)}</td></tr>`).join('')}</table>` : '<p class="suave">No hay reportes.</p>'}
      <p class="suave">Para editar, fusionar u ocultar, use los botones de cada tarjeta en <a href="#/categorias">Categorías</a>.</p>
    </div>`;

  const ff = document.getElementById('ffechas');
  ff.onsubmit = (e) => {
    e.preventDefault();
    const claves = ['f1s', 'f1e', 'f2s', 'f2e', 'f3s', 'f3e'];
    const v = {};
    for (const k of claves) v[k] = new Date(ff[k].value).toISOString();
    const t = claves.map((k) => Date.parse(v[k]));
    for (let i = 1; i < t.length; i++) {
      // Dentro de una fase: inicio < fin. Entre fases: fin ≤ inicio de la siguiente.
      if (i % 2 === 1 ? t[i] <= t[i - 1] : t[i] < t[i - 1]) {
        toast('Las fechas deben ir en orden: cada fase termina antes de que empiece la siguiente.', true);
        return;
      }
    }
    accion(ff.querySelector('button[type=submit]'), async () => {
      await guardar((d) => Object.assign(d.config, v), (d) => claves.every((k) => d.config[k] === v[k]));
      render();
    }, 'Fechas guardadas.');
  };
  const des = document.getElementById('desempatar');
  if (des) des.onclick = () => {
    const ids = [...document.querySelectorAll('#empates input:checked')].map((x) => x.value);
    if (ids.length !== cierre.cupos) { toast(`Debe marcar exactamente ${cierre.cupos}.`, true); return; }
    accion(des, async () => {
      await guardar((d) => { d.config.desempate = ids; }, (d) => JSON.stringify(d.config.desempate) === JSON.stringify(ids));
      render();
    }, 'Categorías oficiales confirmadas.');
  };
}

// ------------------------------------------------------------------
// Arranque
// ------------------------------------------------------------------
function pantallaCrear() {
  $nav.innerHTML = '';
  $app.innerHTML = `<div class="panel ancho"><h2>Crear el concurso</h2>
    <p>Todavía no hay un concurso creado en esta dirección.</p>
    <p><b>Solo el organizador</b> debe tocar este botón, una sola vez. Este dispositivo quedará como organizador.</p>
    <div class="botones"><button class="boton" id="crear">Crear concurso</button></div></div>`;
  const b = document.getElementById('crear');
  b.onclick = () => accion(b, crearConcurso);
}

if (!SALA) {
  pantallaCrear();
} else {
  window.addEventListener('hashchange', render);
  render();
  // Refresca cada 30 s para ver lo que hacen los demás (si la pestaña está visible y no se está escribiendo).
  setInterval(() => {
    const escribiendo = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (document.visibilityState === 'visible' && !escribiendo && !$modal.open) render();
  }, 30000);
}
