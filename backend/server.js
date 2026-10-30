const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');

// ====== KONFIGURASI (dari Environment Variables) ======
const API_KEY = process.env.ROBLOX_API_KEY;
const CREATOR_ID = process.env.CREATOR_ID;
const CREATOR_TYPE = (process.env.CREATOR_TYPE || 'user').toLowerCase(); // user / group
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PORT = process.env.PORT || 3000;

const BASE = 'https://apis.roblox.com/assets/v1';
const MAX_BYTES = 20 * 1024 * 1024;

const TYPES = {
  Animation: ['rbxm', 'rbxmx'],
  Model: ['rbxm', 'rbxmx'],
  Audio: ['mp3', 'wav', 'ogg', 'flac']
};

const MIME = {
  rbxm: 'model/x-rbxm',
  rbxmx: 'model/x-rbxm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac'
};

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// ====== SAJI-KAN FRONTEND ======
// Mengarahkan Express agar membaca folder frontend yang sejajar dengan backend
app.use(express.static(path.join(__dirname, '../frontend')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 }
});

// ====== UTIL ======
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getExt(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

function validateContent(buf, ext) {
  const head = buf.slice(0, 256);
  const ascii = head.toString('latin1');
  switch (ext) {
    case 'rbxm':
      return ascii.startsWith('<roblox!');
    case 'rbxmx':
      return ascii.includes('<roblox');
    case 'mp3':
      return ascii.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case 'wav':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
    case 'ogg':
      return ascii.startsWith('OggS');
    case 'flac':
      return ascii.startsWith('fLaC');
    default:
      return false;
  }
}

async function readError(res) {
  const text = await res.text();
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j.message || j.error || j.title || text;
  } catch (e) {}
  return String(msg).slice(0, 300);
}

function httpErrorMessage(status, detail) {
  if (status === 401) return 'API Key tidak valid atau sudah dicabut.';
  if (status === 403) return 'API Key tidak punya izin assets, atau Creator ID tidak sesuai dengan pemilik API Key. ' + detail;
  if (status === 429) return 'Terlalu banyak request ke Roblox (rate limit). Coba retry beberapa saat lagi.';
  if (status === 400) return 'Roblox menolak permintaan: ' + detail;
  return 'Roblox error (' + status + '): ' + detail;
}

async function robloxFetch(url, options, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429 || i === attempts - 1) return res;
    const wait = Number(res.headers.get('retry-after')) || 2 * (i + 1);
    await sleep(Math.min(wait, 10) * 1000);
  }
}

// ====== UPLOAD KE ROBLOX ======
async function createAsset(type, displayName, file, ext) {
  const creator = CREATOR_TYPE === 'group'
    ? { groupId: String(CREATOR_ID) }
    : { userId: String(CREATOR_ID) };

  const request = {
    assetType: type,
    displayName,
    description: 'Uploaded with JARS Asset Spoofer',
    creationContext: { creator }
  };

  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append(
    'fileContent',
    new Blob([file.buffer], { type: MIME[ext] }),
    file.originalname
  );

  const res = await robloxFetch(BASE + '/assets', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY },
    body: form
  });

  if (!res.ok) {
    const detail = await readError(res);
    const err = new Error(httpErrorMessage(res.status, detail));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function pollOperation(opPath) {
  const opId = String(opPath).split('/').pop();
  for (let i = 0; i < 45; i++) {
    const res = await robloxFetch(BASE + '/operations/' + opId, {
      headers: { 'x-api-key': API_KEY }
    });
    if (!res.ok) {
      const detail = await readError(res);
      throw new Error(httpErrorMessage(res.status, detail));
    }
    const op = await res.json();
    if (op.done) return op;
    await sleep(i < 5 ? 1000 : 2000);
  }
  throw new Error('Roblox belum selesai memproses (timeout). Cek Inventory kamu sebelum retry agar tidak dobel.');
}

// ====== ROUTES ======
app.get('/api/test', async (req, res) => {
  if (!API_KEY) return res.json({ ok: false, message: 'ROBLOK_API_KEY belum diisi di Vercel' });
  if (!CREATOR_ID) return res.json({ ok: false, message: 'CREATOR_ID belum diisi di Vercel' });
  if (!/^\d+$/.test(CREATOR_ID)) return res.json({ ok: false, message: 'CREATOR_ID harus angka saja' });

  try {
    const r = await fetch(BASE + '/operations/00000000-0000-0000-0000-000000000000', {
      headers: { 'x-api-key': API_KEY }
    });
    if (r.status === 401) return res.json({ ok: false, message: 'API Key tidak valid' });
    if (r.status === 403) return res.json({ ok: false, message: 'API Key tidak punya izin assets' });
    return res.json({
      ok: true,
      message: 'API Key diterima (' + CREATOR_TYPE + ' ' + CREATOR_ID + '). Kecocokan creator baru terbukti saat upload.'
    });
  } catch (e) {
    return res.json({ ok: false, message: 'Gagal menghubungi Roblox' });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!API_KEY || !CREATOR_ID) {
      return res.status(500).json({ ok: false, error: 'Server belum dikonfigurasi (API Key / Creator ID).' });
    }
    const type = req.body.type;
    const file = req.file;

    if (!TYPES[type]) return res.status(400).json({ ok: false, error: 'Tipe asset tidak valid.' });
    if (!file) return res.status(400).json({ ok: false, error: 'File tidak ditemukan.' });

    const ext = getExt(file.originalname);
    if (!TYPES[type].includes(ext)) {
      return res.status(400).json({ ok: false, error: 'Format .' + ext + ' tidak didukung untuk ' + type + '.' });
    }
    if (!validateContent(file.buffer, ext)) {
      return res.status(400).json({
        ok: false,
        error: 'Isi file bukan ' + ext.toUpperCase() + ' yang valid. Untuk RBXM/RBXMX, simpan langsung dari Roblox Studio.'
      });
    }

    const displayName = (req.body.name || file.originalname).slice(0, 50) || 'Asset';

    let op = await createAsset(type, displayName, file, ext);
    if (!op.done) op = await pollOperation(op.path);

    if (op.error) {
      return res.status(422).json({
        ok: false,
        error: 'Upload ditolak Roblox: ' + (op.error.message || JSON.stringify(op.error))
      });
    }
    const assetId = op.response && op.response.assetId;
    if (!assetId) {
      return res.status(502).json({ ok: false, error: 'Roblox tidak mengembalikan Asset ID.' });
    }
    return res.json({ ok: true, assetId: String(assetId) });
  } catch (e) {
    console.error('Upload error:', e.message);
    return res.status(e.status && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message });
  }
});

// Fallback agar semua route selain /api membuka index.html frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error dari multer (file kebesaran, dll)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'File lebih dari 20 MB.' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Kesalahan server.' });
});

app.listen(PORT, () => console.log('JARS backend jalan di port ' + PORT));
