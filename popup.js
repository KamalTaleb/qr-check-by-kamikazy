// QR Check by Kamikazy: runs as the extension popup and as a plain page (double-click popup.html).
const $ = (id) => document.getElementById(id);
const link = $('link'), preview = $('preview'), status = $('status');
const QUIET = 4; // blank border in modules, so phones scan reliably
const BUTTONS = ['svg', 'png', 'copy'];

let current = null; // { text, count, isDark }

function say(msg, err) {
  status.textContent = msg || '';
  status.className = 'status' + (err ? ' err' : '');
}

function build() {
  const text = link.value.trim();
  BUTTONS.forEach((id) => ($(id).disabled = !text));
  if (!text) {
    current = null;
    preview.innerHTML = '<p class="hint">Paste a link above</p>';
    say('');
    return;
  }
  try {
    const qr = qrcode(0, $('ecc').value); // 0 = smallest version that fits
    qr.addData(unescape(encodeURIComponent(text)), 'Byte'); // UTF-8, so Arabic links work
    qr.make();
    current = { text, count: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
    preview.innerHTML = svgMarkup();
    say(current.count + ' x ' + current.count + ' modules');
  } catch (e) {
    current = null;
    preview.innerHTML = '<p class="hint">Too long for a QR code</p>';
    BUTTONS.forEach((id) => ($(id).disabled = true));
    say('Shorten the link and try again.', true);
  }
}

// One <path>, dark modules merged per row: a clean vector for print.
function svgMarkup() {
  const { count, isDark } = current;
  const size = count + QUIET * 2;
  let d = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!isDark(r, c)) continue;
      let run = 1;
      while (c + run < count && isDark(r, c + run)) run++;
      d += 'M' + (c + QUIET) + ' ' + (r + QUIET) + 'h' + run + 'v1h-' + run + 'z';
      c += run - 1;
    }
  }
  const bg = $('transparent').checked ? '' : '<rect width="' + size + '" height="' + size + '" fill="' + $('bg').value + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size * 10 + '" height="' + size * 10 + '" shape-rendering="crispEdges">' +
    bg + '<path fill="' + $('fg').value + '" d="' + d + '"/></svg>';
}

function pngBlob() {
  const { count, isDark } = current;
  const total = count + QUIET * 2;
  const px = Math.max(1, Math.floor(Number($('pngSize').value) / total));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = total * px;
  const ctx = canvas.getContext('2d');
  if (!$('transparent').checked) {
    ctx.fillStyle = $('bg').value;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = $('fg').value;
  for (let r = 0; r < count; r++)
    for (let c = 0; c < count; c++)
      if (isDark(r, c)) ctx.fillRect((c + QUIET) * px, (r + QUIET) * px, px, px);
  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

function fileName(ext) {
  let base = 'qr';
  try {
    const u = new URL(/^[a-z]+:/i.test(current.text) ? current.text : 'https://' + current.text);
    base = 'qr-' + (u.hostname + u.pathname).replace(/^www\./, '');
  } catch (e) {}
  return base.replace(/[^a-z0-9.-]+/gi, '-').replace(/-+$/, '').slice(0, 60) + '.' + ext;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  say('Saved ' + name);
}

$('svg').onclick = () => download(new Blob([svgMarkup()], { type: 'image/svg+xml' }), fileName('svg'));
$('png').onclick = async () => download(await pngBlob(), fileName('png'));
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    say('QR copied, paste it anywhere');
  } catch (e) {
    say('Copy not allowed here, use Download.', true);
  }
};

link.oninput = build;
['fg', 'bg', 'transparent', 'ecc'].forEach((id) => ($(id).oninput = build));

// In the extension: offer the current tab's link. As a plain page: hide that button.
const tabs = window.chrome && chrome.tabs;
if (tabs) {
  $('usePage').onclick = () => tabs.query({ active: true, currentWindow: true }, ([t]) => {
    if (t && t.url) { link.value = t.url; build(); }
  });
} else {
  $('usePage').hidden = true;
}
link.focus();
build();
