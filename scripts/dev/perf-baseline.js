/* Meet reproduceerbare baseline voor de board-API (login → board-data → settings).
 * Gebruik: node scripts/dev/perf-baseline.js [runs]
 */
require('dotenv').config();

const BASE = process.env.PERF_BASE_URL || 'http://localhost:3010';
const EMAIL = process.env.PERF_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.PERF_PASSWORD || 'Bootstrap123!';
const RUNS = Number(process.argv[2] || 5);

function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(label, samples) {
  const s = [...samples].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(
    `${label}: n=${s.length} min=${s[0].toFixed(1)}ms med=${pct(s, 50).toFixed(1)}ms p95=${pct(s, 95).toFixed(1)}ms avg=${avg.toFixed(1)}ms max=${s[s.length - 1].toFixed(1)}ms`
  );
}

async function timedFetch(path, opts, cookie) {
  const started = performance.now();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts && opts.headers),
    },
  });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - started;
  return {
    ms,
    status: res.status,
    bytes: buf.byteLength,
    serverTiming: res.headers.get('server-timing'),
    contentEncoding: res.headers.get('content-encoding'),
    setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')],
    body: buf,
  };
}

async function main() {
  console.log(`Baseline tegen ${BASE}, ${RUNS} runs per endpoint`);

  // Login
  const login = await timedFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200) {
    console.error(`Login mislukt: ${login.status} ${Buffer.from(login.body).toString()}`);
    process.exit(1);
  }
  const cookie = (login.setCookie || [])
    .filter(Boolean)
    .map((c) => c.split(';')[0])
    .join('; ');
  console.log(`Login OK (${login.ms.toFixed(1)}ms), cookie: ${cookie.split('=')[0]}`);

  const endpoints = [
    ['GET /api/data/purchase-orders', '/api/data/purchase-orders'],
    ['GET /api/supplier/board-settings/purchase-orders', '/api/supplier/board-settings/purchase-orders'],
    ['GET /api/supplier/board-views/purchase-orders', '/api/supplier/board-views/purchase-orders'],
    ['GET /api/auth/me', '/api/auth/me'],
  ];

  for (const [label, path] of endpoints) {
    const times = [];
    let last;
    for (let i = 0; i < RUNS; i++) {
      last = await timedFetch(path, {}, cookie);
      times.push(last.ms);
    }
    summarize(label, times);
    console.log(
      `  status=${last.status} bytes=${last.bytes} encoding=${last.contentEncoding || 'none'} server-timing=${last.serverTiming || '-'}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
