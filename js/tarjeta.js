// Dibuja la tarjeta del ganador como imagen PNG (1080 x 1350, formato para redes).
'use strict';
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
