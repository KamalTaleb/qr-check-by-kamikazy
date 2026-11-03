// QR Check by Kamikazy: runs as the extension popup and as a plain page (double-click popup.html).
const $ = (id) => document.getElementById(id);
const link = $('link'), stage = $('stage'), frame = $('frame'), canvas = $('qr'), ctx = canvas.getContext('2d');
const statusEl = $('status'), statusText = $('statusText');
const ACTIONS = ['svg', 'png', 'copy'].map($);
const QUIET = 4; // blank border in modules, so phones scan reliably
const ECC_HINT = { L: 'Recovers 7% damage', M: 'Recovers 15% damage', Q: 'Recovers 25% damage', H: 'Recovers 30%, room for a logo' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Settings (remembered per browser, never required) ----------
const radio = (name) => document.querySelector('input[name="' + name + '"]:checked').value;
const settings = () => ({ fg: $('fg').value, bg: $('bg').value, clear: $('transparent').checked, ecc: radio('ecc'), size: radio('pngSize') });

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('qrcheck') || 'null');
    if (!s) return;
    $('fg').value = s.fg; $('bg').value = s.bg; $('transparent').checked = !!s.clear;
    const e = document.querySelector('input[name="ecc"][value="' + s.ecc + '"]'); if (e) e.checked = true;
    const z = document.querySelector('input[name="pngSize"][value="' + s.size + '"]'); if (z) z.checked = true;
    if (s.open) setOptions(true);
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem('qrcheck', JSON.stringify({ ...settings(), open: $('options').classList.contains('open') })); } catch (e) {}
}

// ---------- Status line ----------
function say(text, kind) {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if (statusText.textContent === text) return;
  statusText.textContent = text;
  statusText.style.animation = 'none'; void statusText.offsetWidth; statusText.style.animation = '';
}

// ---------- QR state and build animation ----------
let code = null;   // { text, n, grid: Uint8Array }
let anim = null;   // per-module from/to/delay/dur, plus t0, end and scan timing
let raf = 0;

function makeCode(text, ecc) {
  const qr = qrcode(0, ecc); // 0 = smallest version that fits
  qr.addData(unescape(encodeURIComponent(text)), 'Byte'); // UTF-8, so Arabic links work
  qr.make();
  const n = qr.getModuleCount(), grid = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) grid[r * n + c] = qr.isDark(r, c) ? 1 : 0;
  return { text, n, grid };
}

const easeOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const easeInOut = (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function scaleAt(i, t) {
  const p = clamp01((t - anim.delay[i]) / anim.dur[i]);
  return anim.from[i] + (anim.to[i] - anim.from[i]) * easeOut(p);
}

// A brand new code assembles in a diagonal wave; an edited one only moves the modules that changed.
function startAnim(next) {
  const now = performance.now(), N = next.n * next.n;
  const a = { from: new Float32Array(N), to: new Float32Array(N), delay: new Float32Array(N), dur: new Float32Array(N), grow: new Uint8Array(N), t0: now };
  const sameSize = code && anim && code.n === next.n;
  let last = 0;
  for (let i = 0; i < N; i++) {
    const to = next.grid[i];
    a.to[i] = to;
    if (sameSize) {
      const cur = scaleAt(i, now - anim.t0);
      a.from[i] = cur;
      const changed = Math.abs(cur - to) > 0.01;
      a.delay[i] = changed ? Math.random() * 180 : 0;
      a.dur[i] = changed ? 340 : 1;
      a.grow[i] = changed && to === 1 ? 1 : 0;
    } else {
      const r = Math.floor(i / next.n), c = i % next.n;
      a.from[i] = 0;
      a.delay[i] = ((r + c) / (2 * next.n)) * 560 + Math.random() * 90;
      a.dur[i] = 460;
      a.grow[i] = to;
    }
    if (a.from[i] !== to) last = Math.max(last, a.delay[i] + a.dur[i]);
  }
  a.end = reduceMotion ? 0 : last;
  a.scanDur = reduceMotion ? 0 : 950;
  if (reduceMotion) a.from.set(a.to);
  code = next;
  anim = a;
  stage.classList.add('has-code');
  stage.classList.remove('ready');
  if (!reduceMotion) say('Building ' + next.n + ' x ' + next.n, 'building');
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function tick() {
  const t = performance.now() - anim.t0;
  draw(t);
  if (t > anim.end && anim.scanDur && !anim.checking) { anim.checking = true; say('Checking scan', 'building'); }
  if (t < anim.end + anim.scanDur) raf = requestAnimationFrame(tick);
  else settled();
}

function settled() {
  stage.classList.add('ready');
  const warn = contrastWarning();
  if (warn) say(warn, 'warn');
  else say('Ready · ' + code.n + ' x ' + code.n + ' · ' + code.text.length + ' chars', 'ok');
}

function hexRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function mix(a, b, p) { return 'rgb(' + a.map((x, k) => Math.round(x + (b[k] - x) * p)).join(',') + ')'; }
const ACCENT = [229, 50, 45];

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr);
  if (w && canvas.width !== w) canvas.width = canvas.height = w;
  return w;
}

function draw(t) {
  const W = fitCanvas();
  if (!W || !code) return;
  const { n } = code, total = n + QUIET * 2, cell = W / total, s = settings();
  const fg = hexRgb(s.fg), fgCss = s.fg;
  ctx.clearRect(0, 0, W, W);
  if (!s.clear) { ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, W); }
  const edge = (k) => Math.round((k + QUIET) * cell); // snapped, so neighbours meet with no seams
  for (let r = 0; r < n; r++) {
    const y0 = edge(r), y1 = edge(r + 1);
    for (let c = 0; c < n; c++) {
      const i = r * n + c, k = scaleAt(i, t);
      if (k <= 0.002) continue;
      const x0 = edge(c), x1 = edge(c + 1), w = (x1 - x0) * k, h = (y1 - y0) * k;
      let fill = fgCss;
      if (anim.grow[i]) { // fresh modules land red, then cool to the code colour
        const p = clamp01((t - anim.delay[i]) / (anim.dur[i] * 2.4));
        if (p < 1) fill = mix(ACCENT, fg, easeInOut(p));
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x0 + (x1 - x0 - w) / 2, y0 + (y1 - y0 - h) / 2, w, h);
    }
  }
  // Scan line: one sweep over the finished code, the "check" in QR Check.
  const sp = (t - anim.end) / anim.scanDur;
  if (anim.scanDur && sp > 0 && sp < 1) {
    const y = easeInOut(sp) * W, trail = W * 0.22, fade = Math.sin(sp * Math.PI);
    const g = ctx.createLinearGradient(0, y - trail, 0, y);
    g.addColorStop(0, 'rgba(229,50,45,0)');
    g.addColorStop(1, 'rgba(229,50,45,' + 0.28 * fade + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - trail, W, trail);
    ctx.save();
    ctx.shadowColor = 'rgba(229,50,45,' + fade + ')';
    ctx.shadowBlur = 14 * (window.devicePixelRatio || 1);
    ctx.fillStyle = 'rgba(255,120,110,' + fade + ')';
    ctx.fillRect(0, y - 1.5, W, 3);
    ctx.restore();
  }
}

function redraw() { if (code && anim) draw(performance.now() - anim.t0); }

// ---------- Contrast check, so a code that won't scan is flagged before it is printed ----------
function lum(h) {
  return hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
}
function contrastWarning() {
  const s = settings();
  if (s.clear) return lum(s.fg) > 0.5 ? 'Light code, no back: print it on a dark surface' : '';
  const f = lum(s.fg), b = lum(s.bg), ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
  if (ratio < 3) return 'Low contrast: phones may not read it';
  if (f > b) return 'Light on dark: some phones struggle';
  return '';
}

// ---------- Typing ----------
let timer = 0;
function setEnabled(on) {
  const was = !ACTIONS[0].disabled;
  ACTIONS.forEach((b) => (b.disabled = !on));
  if (on && !was) { ACTIONS[0].classList.remove('armed'); void ACTIONS[0].offsetWidth; ACTIONS[0].classList.add('armed'); }
}

function build() {
  const text = link.value.trim();
  $('clear').hidden = !link.value;
  if (!text) {
    code = null; anim = null; cancelAnimationFrame(raf);
    stage.classList.remove('has-code', 'ready');
    setEnabled(false);
    say('Waiting for a link');
    return;
  }
  let next;
  try { next = makeCode(text, radio('ecc')); }
  catch (e) {
    code = null; anim = null;
    stage.classList.remove('has-code', 'ready');
    setEnabled(false);
    say('Too long for a QR code, shorten the link', 'err');
    return;
  }
  setEnabled(true);
  startAnim(next);
}
const buildSoon = (ms) => { clearTimeout(timer); timer = setTimeout(build, ms); };

link.addEventListener('input', () => { $('clear').hidden = !link.value; buildSoon(170); });
link.addEventListener('paste', () => buildSoon(0));
$('clear').onclick = () => { link.value = ''; build(); link.focus(); };

// ---------- Options ----------
function setOptions(open) {
  $('options').classList.toggle('open', open);
  $('optToggle').setAttribute('aria-expanded', String(open));
}
$('optToggle').onclick = () => { setOptions(!$('options').classList.contains('open')); saveSettings(); };

function syncStyle() {
  const s = settings();
  $('fgHex').textContent = s.fg.toUpperCase();
  $('bgHex').textContent = s.bg.toUpperCase();
  $('fg').nextElementSibling.style.setProperty('--c', s.fg);
  $('bg').nextElementSibling.style.setProperty('--c', s.bg);
  $('bg').parentElement.classList.toggle('off', s.clear);
  $('clearState').textContent = s.clear ? 'On' : 'Off';
  frame.classList.toggle('see-through', s.clear);
  $('eccHint').textContent = ECC_HINT[s.ecc];
  document.querySelectorAll('#presets button').forEach((b) =>
    b.classList.toggle('on', b.dataset.fg === s.fg.toLowerCase() && b.dataset.bg === s.bg.toLowerCase()));
}

document.querySelectorAll('#presets button').forEach((b) => {
  b.style.setProperty('--fg', b.dataset.fg);
  b.style.setProperty('--bg', b.dataset.bg);
  b.onclick = () => { $('fg').value = b.dataset.fg; $('bg').value = b.dataset.bg; $('transparent').checked = false; onStyle(); };
});
function onStyle() { syncStyle(); redraw(); if (stage.classList.contains('ready')) settled(); saveSettings(); }
['fg', 'bg', 'transparent'].forEach((id) => $(id).addEventListener('input', onStyle));
document.querySelectorAll('input[name="ecc"]').forEach((r) => r.addEventListener('change', () => { syncStyle(); saveSettings(); build(); }));
document.querySelectorAll('input[name="pngSize"]').forEach((r) => r.addEventListener('change', saveSettings));
new ResizeObserver(redraw).observe(canvas);

// ---------- Export ----------
function svgMarkup() {
  const { n, grid } = code, size = n + QUIET * 2, s = settings();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r * n + c]) continue;
      let run = 1;
      while (c + run < n && grid[r * n + c + run]) run++; // merge a row of dark modules into one rectangle
      d += 'M' + (c + QUIET) + ' ' + (r + QUIET) + 'h' + run + 'v1h-' + run + 'z';
      c += run - 1;
    }
  }
  const bg = s.clear ? '' : '<rect width="' + size + '" height="' + size + '" fill="' + s.bg + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size * 10 + '" height="' + size * 10 + '" shape-rendering="crispEdges">' +
    bg + '<path fill="' + s.fg + '" d="' + d + '"/></svg>';
}

function pngBlob() {
  const { n, grid } = code, total = n + QUIET * 2, s = settings();
  const px = Math.max(1, Math.floor(Number(s.size) / total));
  const c2 = document.createElement('canvas');
  c2.width = c2.height = total * px;
  const g = c2.getContext('2d');
  if (!s.clear) { g.fillStyle = s.bg; g.fillRect(0, 0, c2.width, c2.height); }
  g.fillStyle = s.fg;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r * n + c]) g.fillRect((c + QUIET) * px, (r + QUIET) * px, px, px);
  return new Promise((ok) => c2.toBlob(ok, 'image/png'));
}

function fileName(ext) {
  let base = 'qr';
  try {
    const u = new URL(/^[a-z]+:/i.test(code.text) ? code.text : 'https://' + code.text);
    base = 'qr-' + (u.hostname + u.pathname).replace(/^www\./, '');
  } catch (e) {}
  return base.replace(/[^a-z0-9.-]+/gi, '-').replace(/-+$/, '').slice(0, 60) + '.' + ext;
}

// A small copy of the code flies from the preview into the button that saved it.
function flyTo(btn) {
  if (reduceMotion) return;
  const from = canvas.getBoundingClientRect(), to = btn.getBoundingClientRect();
  const img = new Image();
  img.src = canvas.toDataURL();
  img.className = 'fly';
  Object.assign(img.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
  document.body.appendChild(img);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  img.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 0.95 },
    { transform: 'translate(' + dx * 0.35 + 'px,' + (dy * 0.2 - 30) + 'px) scale(.55) rotate(-6deg)', opacity: 0.9, offset: 0.45 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.08) rotate(8deg)', opacity: 0 },
  ], { duration: 720, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' }).onfinish = () => img.remove();
}

const doneTimers = new WeakMap();
function markDone(btn) {
  clearTimeout(doneTimers.get(btn));
  btn.classList.remove('done'); void btn.offsetWidth;
  setTimeout(() => btn.classList.add('done'), reduceMotion ? 0 : 520);
  doneTimers.set(btn, setTimeout(() => btn.classList.remove('done'), 2200));
}

function download(blob, name, btn) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flyTo(btn); markDone(btn);
  say('Saved ' + name, 'ok');
}

$('svg').onclick = () => download(new Blob([svgMarkup()], { type: 'image/svg+xml' }), fileName('svg'), $('svg'));
$('png').onclick = async () => download(await pngBlob(), fileName('png'), $('png'));
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    flyTo($('copy')); markDone($('copy'));
    say('Copied, paste it anywhere', 'ok');
  } catch (e) {
    say('Copy is blocked here, use Download', 'err');
  }
};

// ---------- Start ----------
// In the extension: offer the current tab's link. As a plain page: hide that button.
const tabs = window.chrome && chrome.tabs;
if (tabs) {
  $('usePage').onclick = () => tabs.query({ active: true, currentWindow: true }, ([t]) => {
    if (t && t.url) { link.value = t.url; build(); }
  });
} else {
  $('usePage').hidden = true;
}
loadSettings();
syncStyle();
const prefill = new URLSearchParams(location.search).get('link'); // popup.html?link=... opens with a code ready
if (prefill) link.value = prefill;
link.focus();
build();
