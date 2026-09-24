// Premios Dundies – Dirección de Aguas
// Toda la lógica de la web. Las reglas de verdad están en la base de datos
// (supabase/schema.sql); aquí solo se muestran pantallas y se llaman funciones.
'use strict';

const CFG = window.DUNDIES_CONFIG || {};
const CONFIGURED = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('PEGAR') &&
                   CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('PEGAR');
const BASE_URL = location.origin + location.pathname;

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

// Lo que venga en la URL al volver de un correo (confirmación o recuperación).
const URL_HASH = new URLSearchParams(location.hash.replace(/^#/, ''));
const LLEGO_RECUPERACION = URL_HASH.get('type') === 'recovery';
const LLEGO_CONFIRMACION = URL_HASH.get('type') === 'signup' || URL_HASH.get('type') === 'email_change';
const ERROR_EN_URL = URL_HASH.get('error_description');

let sb = null;
let session = null;
let state = null;
let clockOffset = 0;
let timer = null;
let avisoInicio = null;

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
function ahora() { return new Date(Date.now() + clockOffset); }

let toastTimer = null;
function toast(msg, esError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'visible' + (esError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, esError ? 6000 : 3000);
}

function traducir(msg) {
  const m = String(msg || '');
  const tabla = [
    [/Invalid login credentials/i, 'Correo o contraseña incorrectos.'],
    [/Email not confirmed/i, 'Todavía no ha confirmado su correo. Revise su bandeja de entrada (y la de spam).'],
    [/User already registered/i, 'Ese correo ya está registrado. Pruebe iniciar sesión o recuperar la contraseña.'],
    [/Password should be at least (\d+)/i, 'La contraseña debe tener al menos $1 caracteres.'],
    [/New password should be different/i, 'La nueva contraseña debe ser distinta a la anterior.'],
    [/rate limit|too many requests|For security purposes/i, 'Demasiados intentos seguidos. Espere un momento y vuelva a intentarlo.'],
    [/Database error saving new user/i, state && state.allowed_domain
      ? `Solo se permiten correos @${state.allowed_domain}.` : 'No se pudo crear la cuenta. Revise el correo.'],
    [/Unable to validate email address|invalid format/i, 'Ese correo no parece válido.'],
    [/JWT expired|invalid JWT|session.*missing|Auth session missing/i, 'Su sesión venció. Vuelva a iniciar sesión.'],
    [/permission denied/i, 'No tiene permiso para hacer esto. Inicie sesión de nuevo.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'No hay conexión con el servidor. Revise su internet.'],
    [/Email link is invalid or has expired|otp_expired/i, 'El enlace del correo ya venció o ya se usó. Pida uno nuevo.'],
    [/Error sending/i, 'No se pudo enviar el correo. Avísele al administrador (revisar SMTP).'],
  ];
  for (const [re, txt] of tabla) {
    const hit = m.match(re);
    if (hit) return txt.replace('$1', hit[1] || '');
  }
  return m;
}

async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(traducir(error.message));
  return data;
}

// Ejecuta una acción mostrando "cargando" en el botón y el error si falla.
async function accion(boton, fn, mensajeOk) {
  if (boton) boton.disabled = true;
  try {
    await fn();
    if (mensajeOk) toast(mensajeOk);
    return true;
  } catch (e) {
    toast(traducir(e.message), true);
    return false;
  } finally {
    if (boton) boton.disabled = false;
  }
}

function aviso(msg, tipo = 'error') {
  return `<div class="aviso ${tipo}">${esc(msg)}</div>`;
}

// ------------------------------------------------------------------
// Estado general y fases
// ------------------------------------------------------------------
async function cargarEstado() {
  state = await rpc('get_state');
  clockOffset = new Date(state.server_now).getTime() - Date.now();
}

function infoFase() {
  const s = state;
  const ir = (href, label) => ({ href, label });
  switch (s.phase) {
    case 'espera': return { titulo: 'Muy pronto', texto: 'La propuesta de categorías empieza en:', meta: s.f1_start };
    case 'categorias': return { titulo: 'Fase 1 · Categorías', texto: 'Proponga categorías y vote por sus favoritas. Cierra en:', meta: s.f1_end, cta: ir('#/categorias', 'Ir a las categorías') };
    case 'cierre_categorias': return { titulo: 'Fase 1 cerrada', texto: 'El admin está confirmando las 15 categorías oficiales.', cta: ir('#/categorias', 'Ver categorías') };
    case 'pausa_1_2': return { titulo: '¡Ya hay categorías oficiales!', texto: 'Las nominaciones empiezan en:', meta: s.f2_start, cta: ir('#/categorias', 'Ver las oficiales') };
    case 'nominaciones': return { titulo: 'Fase 2 · Nominaciones', texto: 'Nomine a una persona en cada categoría oficial. Cierra en:', meta: s.f2_end, cta: ir('#/nominar', 'Nominar') };
    case 'cierre_nominaciones': return { titulo: 'Nominaciones cerradas', texto: 'El admin está calculando los finalistas.' };
    case 'pausa_2_3': return { titulo: '¡Ya hay finalistas!', texto: 'La votación final empieza en:', meta: s.f3_start };
    case 'final': return { titulo: 'Fase 3 · Votación final', texto: 'Un voto secreto por categoría. Cierra en:', meta: s.f3_end, cta: ir('#/votar', 'Votar') };
    case 'resultados_pendientes': return { titulo: 'Votación cerrada', texto: 'Los ganadores se anunciarán muy pronto. ¡Atentos!' };
    case 'ganadores': return { titulo: '¡Tenemos ganadores!', texto: 'Ya se publicaron los Premios Dundies.', cta: ir('#/ganadores', 'Ver ganadores') };
    default: return { titulo: '', texto: '' };
  }
}

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
  const meta = new Date(el.dataset.meta).getTime();
  const pintar = () => {
    let ms = meta - ahora().getTime();
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
  if (!h.startsWith('#/')) return '';
  return h.slice(2).split('?')[0];
}

function pintarNav() {
  const r = rutaActual();
  const link = (ruta, txt, extra = '') => `<a href="#/${ruta}" class="${r === ruta ? 'activo' : ''} ${extra}">${txt}</a>`;
  let html = link('', 'Inicio');
  if (session) {
    html += link('categorias', 'Categorías') + link('nominar', 'Nominar') + link('votar', 'Votar');
  }
  html += link('ganadores', 'Ganadores');
  if (session) {
    if (state && state.me && state.me.is_admin) html += link('admin', 'Admin');
    html += link('perfil', 'Mi perfil') + '<a href="#" class="salir" id="btn-salir">Salir</a>';
  } else {
    html += link('entrar', 'Entrar', 'salir');
  }
  $nav.innerHTML = `<div class="fila">${html}</div>`;
  const salir = document.getElementById('btn-salir');
  if (salir) salir.onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    session = null;
    location.hash = '#/';
    render();
  };
}

const RUTAS = {
  '': pInicio, entrar: pEntrar, registro: pRegistro, olvide: pOlvide, 'nueva-clave': pNuevaClave,
  categorias: pCategorias, nominar: pNominar, votar: pVotar, ganadores: pGanadores,
  admin: pAdmin, perfil: pPerfil,
};

// Dibuja la página de la ruta actual. Si llega otro pedido mientras dibuja,
// vuelve a dibujar al terminar, así siempre gana la última ruta.
let dibujando = false;
let pendiente = false;
async function render() {
  if (dibujando) { pendiente = true; return; }
  dibujando = true;
  try {
    do {
      pendiente = false;
      await renderUnaVez();
    } while (pendiente);
  } finally {
    dibujando = false;
  }
}

async function renderUnaVez() {
  clearInterval(timer);
  try {
    await cargarEstado();
  } catch (e) {
    $app.innerHTML = aviso('No se pudo conectar con la base de datos: ' + traducir(e.message));
    return;
  }
  pintarNav();
  const fn = RUTAS[rutaActual()] || pInicio;
  try {
    await fn();
  } catch (e) {
    $app.innerHTML = aviso(traducir(e.message));
  }
  arrancarCuenta();
}

function pedirSesion() {
  if (session) return true;
  $app.innerHTML = `<div class="panel">${aviso('Para participar debe iniciar sesión.', 'alerta')}
    <div class="botones"><a class="boton" href="#/entrar">Entrar</a><a class="boton secundario" href="#/registro" style="color:#fff">Crear cuenta</a></div></div>`;
  return false;
}

// ------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------
async function pInicio() {
  const f = infoFase();
  let html = '';
  if (avisoInicio && Date.now() < avisoInicio.hasta) html += `<div class="panel">${aviso(avisoInicio.msg, avisoInicio.tipo)}</div>`;
  html += `<h2 class="seccion">${esc(f.titulo)}</h2><p class="centro fase-actual">${esc(f.texto)}</p>${htmlCuenta(f.meta)}`;

  if (session && state.me) {
    html += `<p class="centro">¡Hola, <b>${esc(state.me.display_name)}</b>!</p>`;
    if (state.phase === 'categorias') {
      html += `<div class="chips"><span class="chip">Le quedan ${state.max_proposals - state.me.proposals_used} propuestas</span>
        <span class="chip">Le quedan ${state.max_votes - state.me.votes_used} votos</span></div>`;
    }
    if (f.cta) html += `<p class="centro"><a class="boton" href="${f.cta.href}">${esc(f.cta.label)}</a></p>`;
  } else {
    html += `<p class="centro"><a class="boton" href="#/entrar">Entrar</a> &nbsp; <a class="boton secundario" style="color:#fff" href="#/registro">Crear cuenta</a></p>`;
    if (state.phase === 'ganadores') html += `<p class="centro"><a href="#/ganadores">Ver ganadores</a></p>`;
  }

  html += `<div class="panel ancho"><h2>¿Cómo funciona?</h2>
    <p><b>1. Categorías</b> (${esc(fecha(state.f1_start))} – ${esc(fecha(state.f1_end))}): cada persona propone hasta ${state.max_proposals} categorías y vota hasta ${state.max_votes}. Las ${state.official_count} más votadas quedan oficiales.</p>
    <p><b>2. Nominaciones</b> (${esc(fecha(state.f2_start))} – ${esc(fecha(state.f2_end))}): en cada categoría oficial se nomina a una persona. Los ${state.finalists_count} más nominados pasan a la final.</p>
    <p><b>3. Votación final</b> (${esc(fecha(state.f3_start))} – ${esc(fecha(state.f3_end))}): un voto secreto por categoría. Nadie, ni el admin, puede ver quién votó por quién.</p>
    <p><b>4. Ganadores</b>: se publican al final, con una tarjeta descargable para cada ganador.</p></div>`;
  $app.innerHTML = html;
}

// ------------------------------------------------------------------
// Cuentas: entrar, registro, olvidé, nueva contraseña, perfil
// ------------------------------------------------------------------
async function pEntrar() {
  if (session) { location.hash = '#/'; return; }
  $app.innerHTML = `<form class="panel" id="f">
    <h2>Entrar</h2>
    <label for="email">Correo</label><input id="email" type="email" autocomplete="email" required>
    <label for="pass">Contraseña</label><input id="pass" type="password" autocomplete="current-password" required>
    <div id="msg"></div>
    <div class="botones"><button class="boton" type="submit">Entrar</button></div>
    <p><a href="#/olvide">¿Olvidaste tu contraseña?</a></p>
    <p>¿No tiene cuenta? <a href="#/registro">Crear cuenta</a></p>
  </form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email, password: f.pass.value });
    btn.disabled = false;
    if (error) {
      const msg = document.getElementById('msg');
      msg.innerHTML = aviso(traducir(error.message));
      if (/not confirmed/i.test(error.message)) {
        msg.innerHTML += '<button class="boton secundario" type="button" id="reenviar" style="color:#fff">Reenviar correo de confirmación</button>';
        document.getElementById('reenviar').onclick = (ev) => accion(ev.target, async () => {
          const { error: er } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: BASE_URL } });
          if (er) throw er;
        }, 'Listo, revise su correo.');
      }
      return;
    }
    session = data.session;
    location.hash = '#/';
  };
}

async function pRegistro() {
  if (session) { location.hash = '#/'; return; }
  const dom = state.allowed_domain;
  $app.innerHTML = `<form class="panel" id="f">
    <h2>Crear cuenta</h2>
    <label for="nombre">Nombre visible</label>
    <input id="nombre" maxlength="40" required placeholder="Así lo verán los demás (ej. María Fernanda R.)">
    <label for="email">Correo${dom ? ` (solo @${esc(dom)})` : ''}</label>
    <input id="email" type="email" autocomplete="email" required>
    <label for="pass">Contraseña</label><input id="pass" type="password" autocomplete="new-password" minlength="8" required>
    <p class="ayuda">Mínimo 8 caracteres.</p>
    <label for="pass2">Repita la contraseña</label><input id="pass2" type="password" autocomplete="new-password" required>
    <div id="msg"></div>
    <div class="botones"><button class="boton" type="submit">Crear cuenta</button></div>
    <p>¿Ya tiene cuenta? <a href="#/entrar">Entrar</a></p>
  </form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const nombre = f.nombre.value.trim();
    const email = f.email.value.trim();
    if (nombre.length < 2) { msg.innerHTML = aviso('El nombre debe tener al menos 2 caracteres.'); return; }
    if (f.pass.value !== f.pass2.value) { msg.innerHTML = aviso('Las contraseñas no coinciden.'); return; }
    if (dom && email.toLowerCase().split('@')[1] !== dom) { msg.innerHTML = aviso(`Solo se permiten correos @${dom}.`); return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email, password: f.pass.value,
      options: { data: { display_name: nombre }, emailRedirectTo: BASE_URL },
    });
    btn.disabled = false;
    if (error) { msg.innerHTML = aviso(traducir(error.message)); return; }
    if (data.session) { session = data.session; location.hash = '#/'; return; }
    f.innerHTML = `<h2>¡Revise su correo!</h2>
      ${aviso(`Le enviamos un enlace a ${email}. Ábralo para confirmar su cuenta. Si no lo ve en unos minutos, revise la carpeta de spam o correo no deseado.`, 'ok')}
      <p><a href="#/entrar">Volver a Entrar</a></p>`;
  };
}

async function pOlvide() {
  $app.innerHTML = `<form class="panel" id="f">
    <h2>Recuperar contraseña</h2>
    <p>Escriba su correo y le enviaremos un enlace para poner una contraseña nueva.</p>
    <label for="email">Correo</label><input id="email" type="email" autocomplete="email" required>
    <div id="msg"></div>
    <div class="botones"><button class="boton" type="submit">Enviar enlace</button></div>
    <p><a href="#/entrar">Volver</a></p>
  </form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: BASE_URL });
    btn.disabled = false;
    document.getElementById('msg').innerHTML = error
      ? aviso(traducir(error.message))
      : aviso('Si ese correo está registrado, le llegará un enlace en unos minutos. Revise también la carpeta de spam.', 'ok');
  };
}

async function pNuevaClave() {
  if (!session) {
    $app.innerHTML = `<div class="panel">${aviso('Este enlace ya no es válido. Pida uno nuevo.')}<p><a href="#/olvide">Recuperar contraseña</a></p></div>`;
    return;
  }
  $app.innerHTML = `<form class="panel" id="f">
    <h2>Nueva contraseña</h2>
    <label for="pass">Contraseña nueva</label><input id="pass" type="password" autocomplete="new-password" minlength="8" required>
    <label for="pass2">Repítala</label><input id="pass2" type="password" autocomplete="new-password" required>
    <div id="msg"></div>
    <div class="botones"><button class="boton" type="submit">Guardar</button></div>
  </form>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    if (f.pass.value !== f.pass2.value) { msg.innerHTML = aviso('Las contraseñas no coinciden.'); return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: f.pass.value });
    btn.disabled = false;
    if (error) { msg.innerHTML = aviso(traducir(error.message)); return; }
    avisoInicio = { msg: '¡Listo! Su contraseña fue cambiada.', tipo: 'ok', hasta: Date.now() + 8000 };
    location.hash = '#/';
  };
}

async function pPerfil() {
  if (!pedirSesion()) return;
  $app.innerHTML = `<form class="panel" id="fn">
    <h2>Mi perfil</h2>
    <p class="suave">${esc(session.user.email)}</p>
    <label for="nombre">Nombre visible</label><input id="nombre" maxlength="40" value="${esc(state.me.display_name)}" required>
    <div class="botones"><button class="boton" type="submit">Guardar nombre</button></div>
  </form>
  <form class="panel" id="fp">
    <h2>Cambiar contraseña</h2>
    <label for="pass">Contraseña nueva</label><input id="pass" type="password" autocomplete="new-password" minlength="8" required>
    <div class="botones"><button class="boton" type="submit">Cambiar contraseña</button></div>
  </form>`;
  const fn = document.getElementById('fn');
  fn.onsubmit = (e) => { e.preventDefault(); accion(fn.querySelector('button'), async () => { await rpc('update_my_name', { p_name: fn.nombre.value }); await render(); }, 'Nombre guardado.'); };
  const fp = document.getElementById('fp');
  fp.onsubmit = (e) => {
    e.preventDefault();
    accion(fp.querySelector('button'), async () => {
      const { error } = await sb.auth.updateUser({ password: fp.pass.value });
      if (error) throw error;
      fp.reset();
    }, 'Contraseña cambiada.');
  };
}

// ------------------------------------------------------------------
// Tarjetas y formulario de categoría
// ------------------------------------------------------------------
function htmlTarjeta(c, { cuerpo = '', para = '', sello = '' } = {}) {
  return `<article class="tarjeta ${c.is_official ? 'oficial' : ''} ${c.status === 'hidden' ? 'oculta' : ''}" data-id="${c.id}">
    ${sello}
    <div class="icono">${ICONS[c.icon] || '💧'}</div>
    <h3>${esc(c.name)}</h3>
    <p class="porque"><b>Porque</b> ${esc(c.reason)}</p>
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

function buscarParecidas(nombre, lista, excluirId) {
  const n = norm(nombre);
  if (n.length < 3) return { igual: null, parecidas: [] };
  const activas = lista.filter((c) => c.status === 'active' && c.id !== excluirId);
  const igual = activas.find((c) => norm(c.name) === n) || null;
  const palabras = n.split(' ').filter((w) => w.length > 3);
  const parecidas = activas.filter((c) => {
    if (c === igual) return false;
    const cn = norm(c.name);
    return cn.includes(n) || n.includes(cn) || palabras.filter((w) => cn.includes(w)).length >= Math.min(2, palabras.length) && palabras.length > 0;
  }).slice(0, 3);
  return { igual, parecidas };
}

// ------------------------------------------------------------------
// Fase 1: categorías
// ------------------------------------------------------------------
let cats = [];
let filtro = { texto: '', orden: 'votos' };

async function pCategorias() {
  if (!pedirSesion()) return;
  cats = await rpc('list_categories');
  const abierta = state.phase === 'categorias';
  const me = state.me;
  const f = infoFase();
  let html = `<h2 class="seccion">Categorías</h2><p class="centro fase-actual">${esc(f.texto)}</p>${abierta ? htmlCuenta(state.f1_end) : ''}`;

  if (abierta) {
    const quedanP = state.max_proposals - me.proposals_used;
    html += `<div class="chips" id="chips"></div>`;
    html += quedanP > 0 ? `<form class="panel ancho" id="fprop">
      <h2>Proponer una categoría</h2>
      <label for="nombre">Nombre de la categoría</label>
      <input id="nombre" maxlength="60" required placeholder="Ej. El más cafetero">
      <div id="dup"></div>
      <label for="porque">Frase corta</label>
      <div class="porque-input"><span>Porque…</span><input id="porque" maxlength="140" required placeholder="nunca suelta la taza"></div>
      <label>Ícono</label>${htmlSelectorIconos('gota')}
      <div id="msg"></div>
      <div class="botones"><button class="boton" type="submit">Proponer</button></div>
    </form>` : `<div class="panel">${aviso(`Ya usó sus ${state.max_proposals} propuestas. Todavía puede votar.`, 'alerta')}</div>`;
  } else if (state.phase === 'espera') {
    html += `<p class="centro">La fase 1 todavía no empieza.</p>`;
  } else if (state.phase1_closed && !state.officials_ready) {
    html += `<div class="panel">${aviso('Hubo un empate en el último puesto. El admin está eligiendo cuáles completan las oficiales.', 'alerta')}</div>`;
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
  if (fp) {
    let icono = 'gota';
    activarSelectorIconos(fp, (i) => { icono = i; });
    fp.nombre.oninput = () => {
      const { igual, parecidas } = buscarParecidas(fp.nombre.value, cats);
      const d = document.getElementById('dup');
      if (igual) d.innerHTML = aviso(`Ya existe "${igual.name}". Mejor vote por esa.`);
      else if (parecidas.length) d.innerHTML = aviso(`Se parece a: ${parecidas.map((c) => `"${c.name}"`).join(', ')}. ¿Seguro que es distinta?`, 'alerta');
      else d.innerHTML = '';
    };
    fp.onsubmit = (e) => {
      e.preventDefault();
      accion(fp.querySelector('button[type=submit]'), async () => {
        await rpc('propose_category', { p_name: fp.nombre.value, p_reason: fp.porque.value.replace(/^\s*porque\s*/i, ''), p_icon: icono });
        fp.reset();
        document.getElementById('dup').innerHTML = '';
        await render();
      }, '¡Categoría propuesta!');
    };
  }
}

function pintarChips() {
  const el = document.getElementById('chips');
  if (!el) return;
  el.innerHTML = `<span class="chip">Le quedan ${state.max_proposals - state.me.proposals_used} propuestas</span>
    <span class="chip">Le quedan ${state.max_votes - state.me.votes_used} votos</span>`;
}

function pintarRejilla() {
  pintarChips();
  const abierta = state.phase === 'categorias';
  const esAdmin = state.me.is_admin;
  const quedanV = state.max_votes - state.me.votes_used;
  let lista = cats.slice();
  // Cuando ya hay oficiales, solo se muestran las oficiales (y las empatadas mientras se decide).
  if (state.officials_ready) lista = lista.filter((c) => c.is_official || esAdmin);
  else if (state.phase1_closed) lista = lista.filter((c) => c.is_official || c.tie_candidate || esAdmin);
  const t = norm(filtro.texto);
  if (t) lista = lista.filter((c) => norm(c.name + ' ' + c.reason).includes(t));
  if (filtro.orden === 'votos') lista.sort((a, b) => (b.is_official - a.is_official) || (b.votes - a.votes) || (a.id - b.id));
  if (filtro.orden === 'nuevas') lista.sort((a, b) => b.id - a.id);
  if (filtro.orden === 'az') lista.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const rej = document.getElementById('rejilla');
  if (!lista.length) { rej.innerHTML = '<p class="centro suave">Todavía no hay categorías. ¡Proponga la primera!</p>'; return; }

  rej.innerHTML = lista.map((c) => {
    let sello = '';
    if (c.status === 'hidden') sello = '<span class="sello oculta">Oculta</span>';
    else if (c.is_official) sello = '<span class="sello">Oficial</span>';
    else if (c.tie_candidate && !state.officials_ready) sello = '<span class="sello empate">Empate</span>';
    let cuerpo = `<p class="autor">Propuesta por ${esc(c.author_name || '—')}${c.is_mine ? ' (usted)' : ''}</p><div class="acciones">`;
    if (abierta && c.status === 'active') {
      cuerpo += c.voted_by_me
        ? `<button class="boton votado" data-act="quitar">✓ Votada · quitar</button>`
        : `<button class="boton" data-act="votar" ${quedanV <= 0 ? 'disabled title="Ya usó todos sus votos"' : ''}>Votar</button>`;
    }
    if (c.status === 'active') cuerpo += `<button class="boton secundario" data-act="reportar" title="Reportar">⚑</button>`;
    cuerpo += `<span class="contador-votos">${c.votes} ${c.votes === 1 ? 'voto' : 'votos'}</span></div>`;
    if (esAdmin && !state.phase1_closed) {
      cuerpo += `<div class="admin-fila">
        ${c.open_reports ? `<span class="sello empate" style="position:static">${c.open_reports} reporte(s)</span>` : ''}
        <button class="boton mini secundario" data-act="editar">Editar</button>
        ${c.status === 'active'
          ? `<button class="boton mini secundario" data-act="fusionar">Fusionar</button><button class="boton mini peligro" data-act="ocultar">Ocultar</button>`
          : `<button class="boton mini secundario" data-act="mostrar">Mostrar</button>`}
      </div>`;
    } else if (esAdmin) {
      cuerpo += `<div class="admin-fila"><button class="boton mini secundario" data-act="editar">Editar</button></div>`;
    }
    return htmlTarjeta(c, { cuerpo, sello });
  }).join('');

  rej.querySelectorAll('[data-act]').forEach((b) => {
    const id = Number(b.closest('.tarjeta').dataset.id);
    const c = cats.find((x) => x.id === id);
    b.onclick = () => accionCategoria(b, b.dataset.act, c);
  });
}

async function refrescarCategorias() {
  await cargarEstado();
  cats = await rpc('list_categories');
  pintarRejilla();
}

async function accionCategoria(btn, act, c) {
  if (act === 'votar') return accion(btn, async () => { await rpc('vote_category', { p_category_id: c.id }); await refrescarCategorias(); });
  if (act === 'quitar') return accion(btn, async () => { await rpc('unvote_category', { p_category_id: c.id }); await refrescarCategorias(); });
  if (act === 'reportar') {
    const motivo = prompt(`¿Por qué reporta "${c.name}"? (opcional)`);
    if (motivo === null) return;
    return accion(btn, () => rpc('report_category', { p_category_id: c.id, p_reason: motivo }), 'Gracias. El admin lo revisará.');
  }
  if (act === 'ocultar') {
    if (!confirm(`¿Ocultar "${c.name}"?\n\nLos votos que tenía se devuelven a quienes la votaron. Luego puede volver a mostrarla, pero esos votos no regresan.`)) return;
    return accion(btn, async () => { await rpc('admin_set_category_hidden', { p_category_id: c.id, p_hidden: true }); await refrescarCategorias(); }, 'Categoría oculta.');
  }
  if (act === 'mostrar') return accion(btn, async () => { await rpc('admin_set_category_hidden', { p_category_id: c.id, p_hidden: false }); await refrescarCategorias(); }, 'Categoría visible de nuevo.');
  if (act === 'editar') return modalEditar(c);
  if (act === 'fusionar') return modalFusionar(c);
}

function modalEditar(c) {
  $modal.innerHTML = `<form class="panel" id="fe" method="dialog">
    <h2>Editar categoría</h2>
    <label for="nombre">Nombre</label><input id="nombre" maxlength="60" required value="${esc(c.name)}">
    <label for="porque">Porque…</label><input id="porque" maxlength="140" required value="${esc(c.reason)}">
    <label>Ícono</label>${htmlSelectorIconos(c.icon)}
    <div class="botones"><button class="boton" type="submit" value="ok">Guardar</button><button class="boton secundario" style="color:#fff" type="button" id="cancelar">Cancelar</button></div>
  </form>`;
  const fe = document.getElementById('fe');
  let icono = c.icon;
  activarSelectorIconos(fe, (i) => { icono = i; });
  document.getElementById('cancelar').onclick = () => $modal.close();
  fe.onsubmit = (e) => {
    e.preventDefault();
    accion(fe.querySelector('button[type=submit]'), async () => {
      await rpc('admin_edit_category', { p_category_id: c.id, p_name: fe.nombre.value, p_reason: fe.porque.value, p_icon: icono });
      $modal.close();
      await refrescarCategorias();
    }, 'Categoría actualizada.');
  };
  $modal.showModal();
}

function modalFusionar(c) {
  const otras = cats.filter((x) => x.status === 'active' && x.id !== c.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  $modal.innerHTML = `<form class="panel" id="ff">
    <h2>Fusionar categoría</h2>
    <p>"<b>${esc(c.name)}</b>" va a desaparecer y sus votos pasan a la categoría que elija. Si alguien votó por las dos, recupera un voto.</p>
    <label for="destino">Pasar a:</label>
    <select id="destino" required><option value="">— Elija —</option>${otras.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <div class="botones"><button class="boton" type="submit">Fusionar</button><button class="boton secundario" style="color:#fff" type="button" id="cancelar">Cancelar</button></div>
  </form>`;
  const ff = document.getElementById('ff');
  document.getElementById('cancelar').onclick = () => $modal.close();
  ff.onsubmit = (e) => {
    e.preventDefault();
    accion(ff.querySelector('button[type=submit]'), async () => {
      await rpc('admin_merge_categories', { p_from: c.id, p_into: Number(ff.destino.value) });
      $modal.close();
      await refrescarCategorias();
    }, 'Categorías fusionadas.');
  };
  $modal.showModal();
}

// ------------------------------------------------------------------
// Fase 2: nominaciones
// ------------------------------------------------------------------
async function pNominar() {
  if (!pedirSesion()) return;
  const f = infoFase();
  if (!state.officials_ready) {
    $app.innerHTML = `<h2 class="seccion">Nominaciones</h2><p class="centro">Las nominaciones empiezan cuando estén listas las categorías oficiales.</p>`;
    return;
  }
  const abierta = state.phase === 'nominaciones';
  const [todas, personas, mias] = await Promise.all([rpc('list_categories'), rpc('list_people'), rpc('my_nominations')]);
  const oficiales = todas.filter((c) => c.is_official && c.status === 'active');
  const miNom = Object.fromEntries(mias.map((n) => [n.category_id, n]));
  const otras = personas.filter((p) => p.id !== state.me.id);

  let html = `<h2 class="seccion">Nominaciones</h2><p class="centro fase-actual">${esc(abierta ? f.texto : 'Las nominaciones no están abiertas en este momento.')}</p>`;
  if (abierta) html += htmlCuenta(state.f2_end);
  html += `<div class="chips"><span class="chip" id="progreso">Nominó en ${mias.length} de ${oficiales.length} categorías</span></div>
    <p class="centro suave">Elija a una persona en cada categoría. Puede cambiarla mientras la fase esté abierta. No se vale nominarse a sí mismo.</p>
    <div class="rejilla">`;
  html += oficiales.map((c) => {
    const actual = miNom[c.id];
    const cuerpo = abierta
      ? `<div class="campo"><select data-cat="${c.id}" aria-label="Nominar en ${esc(c.name)}">
          <option value="">— Elija a una persona —</option>
          ${otras.map((p) => `<option value="${p.id}" ${actual && actual.nominee_id === p.id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}
        </select></div>`
      : '';
    return htmlTarjeta(c, { cuerpo, para: actual ? actual.nominee_name : '' });
  }).join('');
  html += '</div>';
  $app.innerHTML = html;

  $app.querySelectorAll('select[data-cat]').forEach((sel) => {
    sel.onchange = () => accion(sel, async () => {
      const catId = Number(sel.dataset.cat);
      if (sel.value) await rpc('nominate', { p_category_id: catId, p_nominee_id: sel.value });
      else await rpc('remove_nomination', { p_category_id: catId });
      const tarjeta = sel.closest('.tarjeta');
      tarjeta.querySelector('.para .linea').textContent = sel.value ? sel.options[sel.selectedIndex].text : ' ';
      const n = (await rpc('my_nominations')).length;
      document.getElementById('progreso').textContent = `Nominó en ${n} de ${oficiales.length} categorías`;
    }, sel.value ? 'Nominación guardada.' : 'Nominación quitada.');
  });
}

// ------------------------------------------------------------------
// Fase 3: votación final secreta
// ------------------------------------------------------------------
async function pVotar() {
  if (!pedirSesion()) return;
  if (!state.finalists_ready) {
    $app.innerHTML = `<h2 class="seccion">Votación final</h2><p class="centro">La votación final empieza cuando estén listos los finalistas.</p>`;
    return;
  }
  const abierta = state.phase === 'final';
  const [todas, fin] = await Promise.all([rpc('list_categories'), rpc('list_finalists')]);
  const porCat = {};
  fin.forEach((x) => { (porCat[x.category_id] = porCat[x.category_id] || []).push(x); });
  const oficiales = todas.filter((c) => porCat[c.id]);
  const votadas = oficiales.filter((c) => porCat[c.id][0].i_already_voted).length;

  let html = `<h2 class="seccion">Votación final</h2>
    <p class="centro fase-actual">${esc(abierta ? infoFase().texto : state.phase === 'pausa_2_3' ? 'La votación final todavía no empieza.' : 'La votación final está cerrada.')}</p>`;
  if (abierta) html += htmlCuenta(state.f3_end);
  html += `<div class="chips"><span class="chip">Votó en ${votadas} de ${oficiales.length} categorías</span></div>
    <p class="centro suave">🔒 Su voto es secreto: nadie, ni el admin, puede ver por quién votó. Por eso <b>no se puede cambiar</b> una vez enviado.</p>
    <div class="rejilla">`;
  html += oficiales.map((c) => {
    const lista = porCat[c.id];
    const yaVoto = lista[0].i_already_voted;
    let cuerpo;
    if (yaVoto) cuerpo = '<p class="listo">✓ Ya votó en esta categoría.</p>';
    else if (!abierta) cuerpo = `<p class="autor">Finalistas: ${lista.map((x) => esc(x.nominee_name)).join(', ')}</p>`;
    else {
      cuerpo = lista.map((x) => `<label class="opcion"><input type="radio" name="c${c.id}" value="${x.nominee_id}"> ${esc(x.nominee_name)}</label>`).join('') +
        `<div class="acciones"><button class="boton" data-votar="${c.id}">Votar</button></div>`;
    }
    return htmlTarjeta(c, { cuerpo });
  }).join('');
  html += '</div>';
  $app.innerHTML = html;

  $app.querySelectorAll('[data-votar]').forEach((b) => {
    b.onclick = () => {
      const catId = Number(b.dataset.votar);
      const elegido = $app.querySelector(`input[name="c${catId}"]:checked`);
      if (!elegido) { toast('Primero elija a una persona.', true); return; }
      const nombre = elegido.parentElement.textContent.trim();
      const cat = oficiales.find((c) => c.id === catId);
      if (!confirm(`¿Votar por ${nombre} en "${cat.name}"?\n\nEl voto es secreto y NO se puede cambiar.`)) return;
      accion(b, async () => {
        await rpc('cast_final_vote', { p_category_id: catId, p_nominee_id: elegido.value });
        await render();
      }, '¡Voto registrado!');
    };
  });
}

// ------------------------------------------------------------------
// Fase 4: ganadores
// ------------------------------------------------------------------
async function pGanadores() {
  const res = await rpc('get_results');
  const esAdmin = state.me && state.me.is_admin;

  if (!state.results_published) {
    let html = `<h2 class="seccion">Ganadores</h2><p class="centro">Los ganadores se publicarán cuando termine la votación final.</p>`;
    if (esAdmin && res.length) {
      html += `<div class="panel ancho"><h2>Vista previa (solo admin)</h2>
        <p class="suave">Conteo por finalista. Nunca se muestra quién votó por quién.</p>
        <table class="tabla"><tr><th>Categoría</th><th>Finalista</th><th>Votos</th></tr>
        ${res.map((r) => `<tr><td>${esc(r.category_name)}</td><td>${r.is_winner ? '🏆 ' : ''}${esc(r.nominee_name)}</td><td>${r.votes}</td></tr>`).join('')}
        </table>
        <div class="botones"><button class="boton" id="publicar">Publicar resultados</button></div></div>`;
    }
    $app.innerHTML = html;
    const p = document.getElementById('publicar');
    if (p) p.onclick = () => {
      if (!confirm('¿Publicar los resultados? Todos podrán ver a los ganadores.')) return;
      accion(p, async () => { await rpc('admin_publish_results', { p_publish: true }); await render(); }, '¡Resultados publicados!');
    };
    return;
  }

  // Agrupar por categoría (empate = ganadores compartidos).
  const grupos = [];
  res.forEach((r) => {
    let g = grupos.find((x) => x.id === r.category_id);
    if (!g) { g = { id: r.category_id, name: r.category_name, reason: r.category_reason, icon: r.category_icon, nombres: [] }; grupos.push(g); }
    g.nombres.push(r.nominee_name);
  });

  let html = `<h2 class="seccion">🏆 Ganadores 🏆</h2><p class="centro">¡Felicidades a todos los ganadores de los Premios Dundies!</p><div class="rejilla">`;
  html += grupos.map((g, i) => {
    const para = g.nombres.join(' y ');
    const tarjeta = htmlTarjeta({ ...g, is_official: true, status: 'active' }, { para, sello: '<span class="sello">Ganador</span>' });
    return `<div class="tarjeta-ganador-wrap">
      <div class="ganador-marco" id="ganador-${i}">
        <p class="mini-titulo">PREMIOS <b>DUNDIES</b></p>
        <p class="mini-sub">Dirección de Aguas</p>
        ${tarjeta}
        <p class="lema">Porque el agua también nos une…</p>
      </div>
      <button class="boton" data-descargar="${i}" data-nombre="${esc(norm(g.name).replace(/ /g, '-'))}">⬇ Descargar imagen</button>
    </div>`;
  }).join('');
  html += '</div>';
  if (esAdmin) html += `<p class="centro"><button class="boton secundario" style="color:#fff" id="despublicar">Ocultar resultados otra vez</button></p>`;
  $app.innerHTML = html;

  $app.querySelectorAll('[data-descargar]').forEach((b) => {
    b.onclick = () => accion(b, async () => {
      const canvas = await dibujarTarjetaGanador(grupos[Number(b.dataset.descargar)]);
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
      const a = document.createElement('a');
      a.download = `dundies-${b.dataset.nombre}.png`;
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });
  });
  const d = document.getElementById('despublicar');
  if (d) d.onclick = () => accion(d, async () => { await rpc('admin_publish_results', { p_publish: false }); await render(); }, 'Resultados ocultos.');
}

// Dibuja la tarjeta del ganador como imagen PNG (1080 x 1350, formato para redes).
function partirTexto(ctx, texto, ancho) {
  const palabras = String(texto).split(/\s+/);
  const lineas = [];
  let linea = '';
  for (const p of palabras) {
    const prueba = linea ? linea + ' ' + p : p;
    if (ctx.measureText(prueba).width > ancho && linea) { lineas.push(linea); linea = p; } else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function dibujarTarjetaGanador(g) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts.ready; } catch (e) { /* sin fuentes web: usa las del sistema */ }
  const mascota = new Image();
  mascota.src = 'img/gota.svg';
  try { await mascota.decode(); } catch (e) { /* sin mascota si no carga */ }

  // Fondo
  x.fillStyle = '#0a3440';
  x.fillRect(0, 0, W, H);
  const brillo = x.createRadialGradient(220, 0, 0, 220, 0, 800);
  brillo.addColorStop(0, 'rgba(92,205,245,.28)');
  brillo.addColorStop(1, 'rgba(92,205,245,0)');
  x.fillStyle = brillo;
  x.fillRect(0, 0, W, H);

  // Título
  x.textAlign = 'center';
  x.fillStyle = '#ffffff';
  x.font = '800 46px Nunito, system-ui, sans-serif';
  x.fillText('P R E M I O S', W / 2, 120);
  x.fillStyle = '#5ccdf5';
  x.font = '150px "Bebas Neue", Impact, "Arial Narrow", sans-serif';
  x.fillText('DUNDIES', W / 2, 255);
  x.fillStyle = '#a8e6fb';
  x.font = '800 32px Nunito, system-ui, sans-serif';
  x.fillText('DIRECCIÓN DE AGUAS', W / 2, 310);

  // Tarjeta blanca con ola
  const cx = 90, cy = 360, cw = W - 180, ch = 820;
  x.save();
  rectRedondo(x, cx, cy, cw, ch, 44);
  x.fillStyle = '#ffffff';
  x.fill();
  x.clip();
  const olaAlto = 150;
  x.translate(cx, cy + ch - olaAlto);
  x.scale(cw / 400, olaAlto / 52);
  x.fillStyle = '#a8e6fb';
  x.fill(new Path2D('M0 22 C60 2 120 42 200 22 S340 2 400 22 V52 H0z'));
  x.fillStyle = '#5ccdf5';
  x.fill(new Path2D('M0 32 C70 14 130 50 210 32 S350 14 400 32 V52 H0z'));
  x.restore();
  rectRedondo(x, cx, cy, cw, ch, 44);
  x.lineWidth = 10;
  x.strokeStyle = '#f5c542';
  x.stroke();

  // Sello "GANADOR"
  x.font = '900 30px Nunito, system-ui, sans-serif';
  const sello = g.nombres.length > 1 ? 'GANADORES' : 'GANADOR';
  const sw = x.measureText(sello).width + 50;
  rectRedondo(x, cx + cw - sw - 40, cy + 40, sw, 56, 28);
  x.fillStyle = '#f5c542';
  x.fill();
  x.fillStyle = '#4a3500';
  x.textAlign = 'center';
  x.fillText(sello, cx + cw - 40 - sw / 2, cy + 79);

  // Ícono, nombre, "Porque…" y "Para:"
  const izq = cx + 60, ancho = cw - 120;
  let y = cy + 170;
  x.textAlign = 'left';
  x.font = '110px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  x.fillText(ICONS[g.icon] || '💧', izq, y);
  y += 100;
  x.fillStyle = '#145b6e';
  x.font = '900 64px Nunito, system-ui, sans-serif';
  for (const l of partirTexto(x, g.name.toUpperCase(), ancho).slice(0, 3)) { x.fillText(l, izq, y); y += 72; }
  y += 14;
  x.font = 'italic 40px Nunito, system-ui, sans-serif';
  const lineas = partirTexto(x, 'Porque ' + g.reason, ancho).slice(0, 4);
  lineas.forEach((l, i) => {
    if (i === 0) {
      x.font = '900 40px Nunito, system-ui, sans-serif';
      x.fillStyle = '#10303b';
      x.fillText('Porque', izq, y);
      const w = x.measureText('Porque ').width;
      x.font = 'italic 40px Nunito, system-ui, sans-serif';
      x.fillStyle = '#4d6a74';
      x.fillText(l.slice(7), izq + w, y);
    } else {
      x.fillText(l, izq, y);
    }
    y += 52;
  });
  y += 40;
  x.fillStyle = '#10303b';
  x.font = '900 46px Nunito, system-ui, sans-serif';
  x.fillText('Para:', izq, y);
  const pw = x.measureText('Para: ').width;
  x.fillStyle = '#145b6e';
  x.font = '900 52px Nunito, system-ui, sans-serif';
  const para = partirTexto(x, g.nombres.join(' y '), ancho - pw - 150).slice(0, 2);
  para.forEach((l, i) => x.fillText(l, izq + pw, y + i * 60));

  if (mascota.complete && mascota.naturalWidth) x.drawImage(mascota, cx + cw - 190, cy + ch - 250, 130, 169);

  // Lema
  x.textAlign = 'center';
  x.fillStyle = '#ffffff';
  x.font = 'italic 40px Nunito, system-ui, sans-serif';
  x.fillText('Porque el agua también nos une…', W / 2, H - 80);
  return c;
}

// ------------------------------------------------------------------
// Panel del admin
// ------------------------------------------------------------------
async function pAdmin() {
  if (!pedirSesion()) return;
  if (!state.me.is_admin) { $app.innerHTML = aviso('Esta página es solo para el administrador.'); return; }
  const [stats, reportes, todas] = await Promise.all([rpc('admin_stats'), rpc('admin_list_reports'), rpc('list_categories')]);
  const s = state;
  const oficiales = todas.filter((c) => c.is_official).length;
  const empatadas = todas.filter((c) => c.tie_candidate && !c.is_official && c.status === 'active');
  const cupos = s.official_count - oficiales;
  const ocultas = todas.filter((c) => c.status === 'hidden');

  let pasos = '';
  if (!s.phase1_closed) {
    pasos += `<p><b>Fase 1.</b> Cuando pase la fecha de cierre (${esc(fecha(s.f1_end))}), cierre la fase para elegir las ${s.official_count} oficiales.</p>
      <button class="boton" data-paso="cerrar1">Cerrar fase 1 y elegir oficiales</button>`;
  } else if (!s.officials_ready) {
    pasos += `<p><b>Empate.</b> Elija <b>${cupos}</b> de estas categorías empatadas para completar las ${s.official_count} oficiales:</p>
      <div id="empates">${empatadas.map((c) => `<label class="check"><input type="checkbox" value="${c.id}"> ${ICONS[c.icon] || ''} ${esc(c.name)} (${c.votes} votos)</label>`).join('')}</div>
      <button class="boton" data-paso="desempatar">Confirmar elección</button>
      <button class="boton secundario" style="color:#fff" data-paso="reabrir1">Deshacer cierre de fase 1</button>`;
  } else if (!s.finalists_ready) {
    pasos += `<p>✓ Hay ${oficiales} categorías oficiales.</p>
      <p><b>Fase 2.</b> Cuando pase el cierre de nominaciones (${esc(fecha(s.f2_end))}), calcule los finalistas.</p>
      <button class="boton" data-paso="finalistas">Calcular finalistas</button>
      <button class="boton secundario" style="color:#fff" data-paso="reabrir1">Deshacer cierre de fase 1</button>`;
  } else if (!s.results_published) {
    pasos += `<p>✓ Finalistas listos.</p>
      <p><b>Fase 3.</b> Cuando cierre la votación final (${esc(fecha(s.f3_end))}), revise y publique los resultados en <a href="#/ganadores">Ganadores</a>.</p>
      <button class="boton" data-paso="publicar">Publicar resultados</button>
      <button class="boton secundario" style="color:#fff" data-paso="reset-finalistas">Recalcular finalistas (solo si nadie votó)</button>`;
  } else {
    pasos += `<p>✓ Resultados publicados. <a href="#/ganadores">Ver ganadores</a></p>
      <button class="boton secundario" style="color:#fff" data-paso="despublicar">Ocultar resultados</button>`;
  }

  $app.innerHTML = `<h2 class="seccion">Panel del admin</h2>
    <div class="panel ancho"><h2>Participación</h2><div class="stats">
      <div><b>${stats.people}</b>personas</div><div><b>${stats.categories}</b>categorías</div>
      <div><b>${stats.category_votes}</b>votos fase 1</div><div><b>${stats.nominations}</b>nominaciones</div>
      <div><b>${stats.final_voters}</b>votantes finales</div><div><b>${stats.open_reports}</b>reportes</div>
    </div><p class="suave">Fase actual: <b>${esc(infoFase().titulo)}</b></p></div>

    <div class="panel ancho"><h2>Avance del concurso</h2><div id="pasos">${pasos}</div></div>

    <form class="panel ancho" id="ffechas"><h2>Fechas y dominio</h2>
      <p class="suave">Hora de su dispositivo. Para cerrar una fase antes de tiempo, adelante su fecha de cierre.</p>
      <div class="fechas">
        <div><label>Fase 1 empieza</label><input type="datetime-local" name="f1_start" value="${toLocalInput(s.f1_start)}" required></div>
        <div><label>Fase 1 termina</label><input type="datetime-local" name="f1_end" value="${toLocalInput(s.f1_end)}" required></div>
        <div><label>Fase 2 empieza</label><input type="datetime-local" name="f2_start" value="${toLocalInput(s.f2_start)}" required></div>
        <div><label>Fase 2 termina</label><input type="datetime-local" name="f2_end" value="${toLocalInput(s.f2_end)}" required></div>
        <div><label>Fase 3 empieza</label><input type="datetime-local" name="f3_start" value="${toLocalInput(s.f3_start)}" required></div>
        <div><label>Fase 3 termina</label><input type="datetime-local" name="f3_end" value="${toLocalInput(s.f3_end)}" required></div>
      </div>
      <label>Solo aceptar correos de este dominio (vacío = cualquier correo)</label>
      <input name="dominio" placeholder="ej. aya.go.cr" value="${esc(s.allowed_domain || '')}">
      <p class="ayuda">Aplica a registros nuevos. Las cuentas ya creadas no se borran.</p>
      <button class="boton" type="submit">Guardar</button>
    </form>

    <div class="panel ancho"><h2>Reportes pendientes (${reportes.length})</h2>
      ${reportes.length ? `<table class="tabla"><tr><th>Categoría</th><th>Motivo</th><th></th></tr>
        ${reportes.map((r) => `<tr><td>${esc(r.category_name)}<br><span class="suave">por ${esc(r.reported_by_name)}</span></td>
          <td>${esc(r.reason || '—')}</td>
          <td>${!s.phase1_closed ? `<button class="boton mini peligro" data-ocultar="${r.category_id}">Ocultar</button>` : ''}
              <button class="boton mini" data-descartar="${r.report_id}">Descartar</button></td></tr>`).join('')}
        </table>` : '<p class="suave">No hay reportes.</p>'}
      <p class="suave">Para editar o fusionar categorías, use los botones de cada tarjeta en <a href="#/categorias">Categorías</a>.</p>
    </div>

    ${ocultas.length ? `<div class="panel ancho"><h2>Categorías ocultas</h2>
      ${ocultas.map((c) => `<p>${ICONS[c.icon] || ''} ${esc(c.name)} ${!s.phase1_closed ? `<button class="boton mini" data-mostrar="${c.id}">Mostrar</button>` : ''}</p>`).join('')}</div>` : ''}`;

  // Pasos del concurso
  $app.querySelectorAll('[data-paso]').forEach((b) => {
    b.onclick = () => {
      const p = b.dataset.paso;
      if (p === 'cerrar1') {
        if (!confirm('¿Cerrar la fase 1? Ya nadie podrá proponer ni votar categorías.')) return;
        return accion(b, async () => {
          const r = await rpc('admin_close_phase1');
          if (r.tie) toast(`Hubo empate: elija ${r.slots_to_choose} de ${r.tied_candidates} categorías.`);
          else toast(`¡Listo! ${r.officials} categorías oficiales.`);
          await render();
        });
      }
      if (p === 'desempatar') {
        const ids = [...document.querySelectorAll('#empates input:checked')].map((x) => Number(x.value));
        if (ids.length !== cupos) { toast(`Debe marcar exactamente ${cupos}.`, true); return; }
        return accion(b, async () => { await rpc('admin_resolve_phase1_tie', { p_category_ids: ids }); await render(); }, 'Categorías oficiales confirmadas.');
      }
      if (p === 'reabrir1') {
        if (!confirm('¿Deshacer el cierre de la fase 1? Las categorías dejan de ser oficiales. Después mueva la fecha de cierre de la fase 1 hacia adelante.')) return;
        return accion(b, async () => { await rpc('admin_reopen_phase1'); await render(); }, 'Fase 1 reabierta.');
      }
      if (p === 'finalistas') {
        if (!confirm('¿Cerrar nominaciones y calcular finalistas?')) return;
        return accion(b, async () => { const r = await rpc('admin_compute_finalists'); toast(`Listo: ${r.finalists} finalistas.`); await render(); });
      }
      if (p === 'reset-finalistas') {
        if (!confirm('¿Borrar los finalistas para recalcularlos? Solo funciona si nadie ha votado en la final.')) return;
        return accion(b, async () => { await rpc('admin_reset_finalists'); await render(); }, 'Finalistas borrados.');
      }
      if (p === 'publicar') {
        if (!confirm('¿Publicar los resultados?')) return;
        return accion(b, async () => { await rpc('admin_publish_results', { p_publish: true }); await render(); }, '¡Resultados publicados!');
      }
      if (p === 'despublicar') return accion(b, async () => { await rpc('admin_publish_results', { p_publish: false }); await render(); }, 'Resultados ocultos.');
    };
  });

  const ff = document.getElementById('ffechas');
  ff.onsubmit = (e) => {
    e.preventDefault();
    const iso = (n) => new Date(ff[n].value).toISOString();
    accion(ff.querySelector('button[type=submit]'), async () => {
      await rpc('admin_update_config', {
        p_f1_start: iso('f1_start'), p_f1_end: iso('f1_end'),
        p_f2_start: iso('f2_start'), p_f2_end: iso('f2_end'),
        p_f3_start: iso('f3_start'), p_f3_end: iso('f3_end'),
        p_allowed_domain: ff.dominio.value,
      });
      await render();
    }, 'Configuración guardada.');
  };

  $app.querySelectorAll('[data-descartar]').forEach((b) => {
    b.onclick = () => accion(b, async () => { await rpc('admin_resolve_report', { p_report_id: Number(b.dataset.descartar) }); await render(); }, 'Reporte descartado.');
  });
  $app.querySelectorAll('[data-ocultar]').forEach((b) => {
    b.onclick = () => {
      if (!confirm('¿Ocultar esta categoría? Sus votos se devuelven a quienes la votaron.')) return;
      accion(b, async () => { await rpc('admin_set_category_hidden', { p_category_id: Number(b.dataset.ocultar), p_hidden: true }); await render(); }, 'Categoría oculta.');
    };
  });
  $app.querySelectorAll('[data-mostrar]').forEach((b) => {
    b.onclick = () => accion(b, async () => { await rpc('admin_set_category_hidden', { p_category_id: Number(b.dataset.mostrar), p_hidden: false }); await render(); }, 'Categoría visible.');
  });
}

// ------------------------------------------------------------------
// Pantalla cuando falta conectar Supabase
// ------------------------------------------------------------------
function pantallaSinConfigurar() {
  $nav.innerHTML = '';
  $app.innerHTML = `<div class="panel ancho"><h2>Falta conectar la base de datos</h2>
    <p>La web está lista, pero todavía no sabe a qué proyecto de Supabase conectarse.</p>
    <ol>
      <li>Cree el proyecto en Supabase y pegue el script <code>supabase/schema.sql</code> (README, pasos 1 y 2).</li>
      <li>Copie el <b>Project URL</b> y la <b>anon public key</b> (README, paso 4).</li>
      <li>Péguelos en el archivo <code>js/config.js</code> del repositorio y guarde.</li>
    </ol>
    <p>En 1–2 minutos esta página se convierte en la web de los Premios Dundies.</p></div>`;
}

// ------------------------------------------------------------------
// Arranque
// ------------------------------------------------------------------
async function iniciar() {
  if (!CONFIGURED) { pantallaSinConfigurar(); return; }
  if (!window.supabase) {
    $app.innerHTML = aviso('No se pudo cargar la librería de Supabase. Revise su conexión y recargue la página.');
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  sb.auth.onAuthStateChange((evento, s) => {
    session = s;
    if (evento === 'PASSWORD_RECOVERY' && rutaActual() !== 'nueva-clave') {
      history.replaceState(null, '', '#/nueva-clave');
      render();
    }
    if (evento === 'SIGNED_OUT') { state = null; }
  });
  const { data } = await sb.auth.getSession();
  session = data.session;

  // Limpiar tokens de la URL al volver desde un correo.
  if (LLEGO_RECUPERACION) {
    history.replaceState(null, '', '#/nueva-clave');
  } else if (ERROR_EN_URL) {
    avisoInicio = { msg: traducir(ERROR_EN_URL), tipo: 'error', hasta: Date.now() + 15000 };
    history.replaceState(null, '', '#/');
  } else if (LLEGO_CONFIRMACION) {
    avisoInicio = { msg: '¡Correo confirmado! Ya puede participar.', tipo: 'ok', hasta: Date.now() + 15000 };
    history.replaceState(null, '', '#/');
  } else if (location.hash && !location.hash.startsWith('#/')) {
    history.replaceState(null, '', '#/');
  }

  window.addEventListener('hashchange', render);
  render();
}

iniciar();
