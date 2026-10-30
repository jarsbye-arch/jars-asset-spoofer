// ====== KONFIGURASI ======
// Diisi di Tahap 6 dengan URL backend Render kamu
const API_URL = window.location.origin;

const TYPES = {
  animation: {
    title: 'Animation', apiType: 'Animation', exts: ['rbxm', 'rbxmx'], max: 50,
    hint: 'Upload file RBXM/RBXMX berisi animasi. Maksimal 50 file per batch.'
  },
  model: {
    title: 'Model', apiType: 'Model', exts: ['rbxm', 'rbxmx'], max: 50,
    hint: 'Upload file RBXM/RBXMX. Struktur model tidak diubah. Maksimal 50 file per batch.'
  },
  audio: {
    title: 'Audio', apiType: 'Audio', exts: ['mp3', 'wav', 'ogg', 'flac'], max: 50,
    hint: 'Upload MP3/WAV/OGG/FLAC (maks 7 menit per file). File asli tidak dikompres ulang. Maksimal 50 file per batch.'
  }
};
const MAX_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 2;
const HISTORY_KEY = 'jars_history_v1';

// ====== STATE ======
let current = 'animation';
const queues = { animation: [], model: [], audio: [] };
const running = { animation: false, model: false, audio: false };
const cancelled = { animation: false, model: false, audio: false };
let nextId = 1;

// ====== ELEMEN ======
const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone'), fileInput = $('fileInput'), fileList = $('fileList');

// ====== UTIL ======
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function ext(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function fmtDur(s) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    document.body.removeChild(ta);
  }
  toast('Tersalin');
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ====== TAB ======
document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => {
    current = b.dataset.type;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    renderAll();
  });
});

// ====== PILIH FILE ======
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
);
dropzone.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer.files || [])));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

function addFiles(files) {
  const cfg = TYPES[current];
  const q = queues[current];
  let added = 0, skipped = [];
  for (const f of files) {
    if (q.length >= cfg.max) { skipped.push('Batas ' + cfg.max + ' file tercapai'); break; }
    if (!cfg.exts.includes(ext(f.name))) { skipped.push(f.name + ': format tidak didukung'); continue; }
    if (f.size > MAX_BYTES) { skipped.push(f.name + ': lebih dari 20 MB'); continue; }
    if (f.size === 0) { skipped.push(f.name + ': file kosong'); continue; }
    if (q.some((x) => x.file.name === f.name && x.file.size === f.size)) { skipped.push(f.name + ': sudah ada'); continue; }
    const item = {
      id: nextId++, file: f, status: 'waiting', progress: 0,
      assetId: null, error: null, xhr: null, meta: ''
    };
    q.push(item);
    added++;
    if (current === 'audio') readAudioMeta(item);
  }
  renderAll();
  if (added) toast(added + ' file ditambahkan');
  if (skipped.length) toast(skipped[0] + (skipped.length > 1 ? ' (+' + (skipped.length - 1) + ')' : ''));
}

function readAudioMeta(item) {
  try {
    const a = new Audio();
    const url = URL.createObjectURL(item.file);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (isFinite(a.duration)) {
        item.meta = 'Durasi ' + fmtDur(a.duration);
        if (a.duration > 420) item.meta += ' (lebih dari 7 menit, kemungkinan ditolak)';
      }
      URL.revokeObjectURL(url);
      renderList();
    };
    a.onerror = () => URL.revokeObjectURL(url);
    a.src = url;
  } catch (e) {}
}

$('clearBtn').addEventListener('click', () => {
  if (running[current]) return toast('Tunggu upload selesai atau tekan Cancel');
  queues[current] = [];
  renderAll();
});

// ====== RENDER ======
function statusLabel(s) {
  return { waiting: 'Waiting', processing: 'Processing', uploading: 'Uploading', success: 'Success', failed: 'Failed' }[s];
}

function renderList() {
  const q = queues[current];
  fileList.innerHTML = '';
  q.forEach((it) => {
    const li = document.createElement('li');
    li.className = 'file-item';

    const top = document.createElement('div');
    top.className = 'f-top';
    const name = document.createElement('div');
    name.className = 'f-name';
    name.textContent = it.file.name;
    const badge = document.createElement('span');
    badge.className = 'badge ' + it.status;
    badge.textContent = statusLabel(it.status);
    const rm = document.createElement('button');
    rm.className = 'f-remove';
    rm.textContent = '\u00d7';
    rm.setAttribute('aria-label', 'Hapus');
    rm.addEventListener('click', () => {
      if (it.status === 'uploading' || it.status === 'processing') return toast('Sedang diproses');
      queues[current] = queues[current].filter((x) => x !== it);
      renderAll();
    });
    top.append(name, badge, rm);

    const meta = document.createElement('div');
    meta.className = 'f-meta';
    meta.textContent = fmtSize(it.file.size) + (it.meta ? ' \u2022 ' + it.meta : '');

    const bar = document.createElement('div');
    bar.className = 'f-bar';
    const fill = document.createElement('div');
    fill.style.width = it.progress + '%';
    bar.appendChild(fill);

    li.append(top, meta, bar);

    if (it.assetId) {
      const row = document.createElement('div');
      row.className = 'f-id';
      const span = document.createElement('span');
      span.textContent = 'Asset ID baru: ' + it.assetId;
      const btn = document.createElement('button');
      btn.textContent = 'COPY ID';
      btn.addEventListener('click', () => copyText(it.assetId));
      row.append(span, btn);
      li.appendChild(row);
    }
    if (it.error) {
      const er = document.createElement('div');
      er.className = 'f-err';
      er.textContent = it.error;
      li.appendChild(er);
    }
    fileList.appendChild(li);
  });
  if (!q.length) {
    const e = document.createElement('li');
    e.className = 'empty';
    e.textContent = 'Belum ada file';
    fileList.appendChild(e);
  }
}

function renderOverall() {
  const q = queues[current];
  const total = q.length;
  const done = q.filter((x) => x.status === 'success').length;
  const failed = q.filter((x) => x.status === 'failed').length;
  let sum = 0;
  q.forEach((x) => { sum += x.status === 'success' || x.status === 'failed' ? 100 : x.progress; });
  const pct = total ? Math.round(sum / total) : 0;
  $('overallBar').style.width = pct + '%';
  $('overallPct').textContent = pct + '%';
  let text = 'Siap';
  if (running[current]) text = 'Memproses... ' + done + '/' + total;
  else if (total && done + failed === total) text = 'Selesai: ' + done + ' sukses, ' + failed + ' gagal';
  else if (total) text = total + ' file siap diupload';
  $('overallText').textContent = text;
  $('counter').textContent = total + ' / ' + TYPES[current].max + ' file';
  $('uploadBtn').disabled = running[current] || !q.some((x) => x.status === 'waiting');
  $('retryBtn').disabled = running[current] || !q.some((x) => x.status === 'failed');
  $('cancelBtn').disabled = !running[current];
}

function renderHeader() {
  $('title').textContent = TYPES[current].title;
  $('hint').textContent = TYPES[current].hint;
  $('dzSub').textContent = 'Format: ' + TYPES[current].exts.join(', ').toUpperCase() + ' \u2022 atau seret file ke sini';
}

function renderAll() {
  renderHeader();
  renderList();
  renderOverall();
}

// ====== UPLOAD ======
function uploadOne(type, item) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    item.status = 'uploading';
    item.progress = 0;
    item.error = null;
    if (current === type) { renderList(); renderOverall(); }

    xhr.open('POST', API_URL.replace(/\/$/, '') + '/api/upload');
    xhr.timeout = 5 * 60 * 1000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 70);
        if (current === type) { renderList(); renderOverall(); }
      }
    };
    xhr.upload.onload = () => {
      item.status = 'processing';
      item.progress = 75;
      if (current === type) { renderList(); renderOverall(); }
    };
    const fail = (msg) => {
      item.status = 'failed';
      item.error = msg;
      item.xhr = null;
      resolve();
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok && data.assetId) {
        item.status = 'success';
        item.progress = 100;
        item.assetId = String(data.assetId);
        item.xhr = null;
        saveHistory({
          name: item.file.name, type, assetId: item.assetId, time: new Date().toISOString()
        });
        resolve();
      } else {
        fail((data && data.error) || 'Gagal (HTTP ' + xhr.status + ')');
      }
    };
    xhr.onerror = () => fail('Tidak bisa terhubung ke backend. Cek API_URL atau tunggu server bangun (sekitar 1 menit).');
    xhr.ontimeout = () => fail('Waktu habis. Coba retry.');
    xhr.onabort = () => fail('Dibatalkan');

    const fd = new FormData();
    fd.append('type', TYPES[type].apiType);
    fd.append('name', item.file.name.replace(/\.[^.]+$/, '').slice(0, 50));
    fd.append('file', item.file, item.file.name);
    xhr.send(fd);
  });
}

async function runQueue(type) {
  if (running[type]) return;
  if (!API_URL || API_URL.startsWith('GANTI')) {
    return toast('API_URL belum diisi (Tahap 6)');
  }
  running[type] = true;
  cancelled[type] = false;
  renderOverall();

  const q = queues[type];
  const pending = q.filter((x) => x.status === 'waiting');
  let idx = 0;
  async function worker() {
    while (idx < pending.length && !cancelled[type]) {
      const item = pending[idx++];
      await uploadOne(type, item);
      if (current === type) renderAll();
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, pending.length); i++) workers.push(worker());
  await Promise.all(workers);

  // yang belum sempat jalan tetap waiting
  running[type] = false;
  if (current === type) renderAll();
  renderHistory();
  const ok = q.filter((x) => x.status === 'success').length;
  toast(cancelled[type] ? 'Upload dibatalkan' : 'Selesai: ' + ok + ' sukses');
}

$('uploadBtn').addEventListener('click', () => runQueue(current));
$('retryBtn').addEventListener('click', () => {
  // hanya file gagal yang diulang, file sukses tidak disentuh
  queues[current].forEach((x) => {
    if (x.status === 'failed') { x.status = 'waiting'; x.error = null; x.progress = 0; }
  });
  renderAll();
  runQueue(current);
});
$('cancelBtn').addEventListener('click', () => {
  cancelled[current] = true;
  queues[current].forEach((x) => { if (x.xhr && x.status === 'uploading') x.xhr.abort(); });
  toast('Membatalkan...');
});

// ====== EXPORT ======
function successItems() {
  return queues[current].filter((x) => x.status === 'success');
}
$('copyAllBtn').addEventListener('click', () => {
  const s = successItems();
  if (!s.length) return toast('Belum ada ID');
  copyText(s.map((x) => x.assetId).join('\n'));
});
$('txtBtn').addEventListener('click', () => {
  const s = successItems();
  if (!s.length) return toast('Belum ada ID');
  download('jars-' + current + '-ids.txt', s.map((x) => x.file.name + ' = ' + x.assetId).join('\n'), 'text/plain');
});
$('csvBtn').addEventListener('click', () => {
  const s = successItems();
  if (!s.length) return toast('Belum ada ID');
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = ['file,type,new_asset_id'].concat(s.map((x) => [esc(x.file.name), current, x.assetId].join(',')));
  download('jars-' + current + '-ids.csv', rows.join('\n'), 'text/csv');
});

// ====== RIWAYAT ======
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { return []; }
}
function saveHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 500))); } catch (e) {}
}
function renderHistory() {
  const list = $('historyList');
  const q = $('historySearch').value.trim().toLowerCase();
  const f = $('historyFilter').value;
  const items = loadHistory().filter((h) =>
    (f === 'all' || h.type === f) &&
    (!q || h.name.toLowerCase().includes(q) || String(h.assetId).includes(q))
  );
  list.innerHTML = '';
  if (!items.length) {
    const e = document.createElement('li');
    e.className = 'empty';
    e.textContent = 'Riwayat kosong';
    list.appendChild(e);
    return;
  }
  items.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'h-item';
    const b = document.createElement('b');
    b.textContent = h.name;
    const m = document.createElement('div');
    m.className = 'muted';
    m.textContent = TYPES[h.type].title + ' \u2022 ' + new Date(h.time).toLocaleString();
    const row = document.createElement('div');
    row.className = 'f-id';
    const span = document.createElement('span');
    span.textContent = 'ID: ' + h.assetId;
    const btn = document.createElement('button');
    btn.textContent = 'COPY ID';
    btn.addEventListener('click', () => copyText(String(h.assetId)));
    row.append(span, btn);
    li.append(b, m, row);
    list.appendChild(li);
  });
}
$('historySearch').addEventListener('input', renderHistory);
$('historyFilter').addEventListener('change', renderHistory);
$('clearHistoryBtn').addEventListener('click', () => {
  if (confirm('Hapus semua riwayat?')) {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    renderHistory();
  }
});

// ====== TEST API ======
$('testBtn').addEventListener('click', async () => {
  const st = $('apiStatus');
  if (!API_URL || API_URL.startsWith('GANTI')) {
    st.className = 'api-status err';
    st.textContent = 'API_URL belum diisi';
    return;
  }
  st.className = 'api-status';
  st.innerHTML = '<span class="spin"></span>Mengecek (server bisa butuh 1 menit)...';
  try {
    const r = await fetch(API_URL.replace(/\/$/, '') + '/api/test');
    const d = await r.json();
    st.className = 'api-status ' + (d.ok ? 'ok' : 'err');
    st.textContent = d.message || (d.ok ? 'Terhubung' : 'Gagal');
  } catch (e) {
    st.className = 'api-status err';
    st.textContent = 'Tidak bisa terhubung ke backend';
  }
});

// ====== START ======
renderAll();
renderHistory();
