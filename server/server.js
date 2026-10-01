'use strict';

require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const sql = require('mssql');
const SqlSessionStore = require('./services/SqlSessionStore');
const d365ODataService = require('./services/D365ODataService');
const { runWithRequestTiming, buildServerTimingHeader } = require('./utils/timing');

const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const supplierRouter = require('./routes/supplier');
const dataRouter = require('./routes/data');
const biRouter = require('./routes/bi');
const dataLinksRouter = require('./routes/dataLinks');
const rccpRouter = require('./routes/rccp');
const { rccpAccess } = require('./middleware/rccpAccess');
const { createMediaRouter } = require('./routes/media');
const { requireSession, requireAnyRole, requireRole } = require('./middleware/auth');
const { restrictSupplierDataAccess } = require('./middleware/dataAccess');
const refreshRunService = require('./services/RefreshRunService');
const internalNightRefreshRouter = require('./routes/internalNightRefresh');
const errorHandler = require('./middleware/errorHandler');
const { ROLES } = require('./constants/roles');
const { logger } = require('./utils/logger');
const {
  DEFAULT_LOCAL_APP_ORIGIN,
  useSecureSessionCookies,
} = require('./utils/appEnvironment');

// Robuustheid: een transiente fout buiten de request-keten (bv. een 'error'-event van de
// MSSQL-connection-pool of session-store bij een korte DB-hapering) zou anders een
// uncaughtException geven en het proces met exit 1 omleggen (crash-loop in containers).
// We loggen die gevallen i.p.v. crashen; de pool reconnect vanzelf bij de volgende query.
process.on('unhandledRejection', (reason) => {
  logger.error('Onverwerkte promise-rejection', { reason: reason && reason.message ? reason.message : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Onverwerkte uitzondering', { error: err && err.stack ? err.stack : String(err) });
});

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

// Gzip/brotli-compressie op alle responses. De frontend-bundle en de board-JSON-payloads
// zijn tekstueel en comprimeren ~4x; dit verkort de laadtijd fors zonder verdere ingrepen.
app.use(compression());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [DEFAULT_LOCAL_APP_ORIGIN];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

function shouldSkipGlobalRateLimit(req) {
  const requestPath = String(req.path || '').trim();
  if (requestPath === '/api/purchase-orders/refresh/progress') return true;
  // Product-images zijn één request per uniek item; een beeld-zwaar bord vuurt er tientallen
  // tegelijk af. Die vallen al onder de eigen media-limiter (zie routes/media.js), dus tel ze
  // niet óók mee in de globale 100/min-limiet — anders zet één board-load de hele app op 429.
  if (requestPath.startsWith('/api/media/')) return true;
  return /^\/api\/data\/[^/]+\/refresh\/progress$/.test(requestPath);
}

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Refresh-voortgang wordt tijdens een actieve D365-sync periodiek gepolld; die requests mogen
  // niet door de globale limiter worden afgekapt, anders lijkt de refresh "vastgelopen".
  skip: shouldSkipGlobalRateLimit,
}));

app.use(express.json({ limit: '1mb' }));

// Publieke health-endpoints vóór session/rate-limit zodat probes en deploy-checks nooit
// afhangen van DB/session-store of een volle rate-limit bucket.
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Readiness-check voor de D365-koppeling. Bewust géén onderdeel van /api/health: dat is de
// liveness-probe van de Container App, en een D365-storing mag geen restart uitlokken.
// Wordt na een deploy aangeroepen (deploy-prod.yml) zodat een kapotte koppeling de deploy laat falen.
app.get('/api/health/d365', async (_req, res) => {
  const result = await d365ODataService.checkHealth();
  res.status(result.status === 'ok' ? 200 : 503).json(result);
});

// Eigen MSSQL-session-store op de gedeelde app-pool (sql.connect), i.p.v. connect-mssql-v2.
// Die had een eigen losse pool met een race in ready(): bij parallelle requests vlak na login
// bleef store.get hangen (alleen in de container). Door dezelfde, bewezen werkende pool als de
// routes te gebruiken, verdwijnt die hang. Zie server/services/SqlSessionStore.js.
const sessionStore = new SqlSessionStore();
// Vang connectiefouten van de session-store op zodat een DB-hapering het proces niet omlegt.
sessionStore.on('error', (err) => {
  logger.error('Session-store fout', { error: err && err.message ? err.message : String(err) });
});
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET moet gezet zijn en minimaal 32 tekens bevatten');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  name: process.env.SESSION_COOKIE_NAME || 'vendorportal.sid',
  cookie: {
    httpOnly: true,
    secure: useSecureSessionCookies(),
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_TTL_HOURS || '8') * 60 * 60 * 1000,
  },
}));

// Server-Timing-header: totale server-verwerkingstijd (+ benoemde sub-metingen via
// utils/timing.time()) per request, zichtbaar in DevTools → Network → Timing. Webstandaard,
// geen eigen UI nodig. Bewust NÁ express-session gemount zodat onze res.end-patch als eerste
// draait (vóór de async session-save) en de header dus altijd gezet wordt vóór het flushen.
// De request draait in een AsyncLocalStorage-timing-context zodat elk codeblok (ook diep in een
// service) via time() zijn duur kan bijdragen.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  runWithRequestTiming(() => {
    const originalEnd = res.end;
    res.end = function timedEnd(...args) {
      if (!res.headersSent) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        try {
          res.setHeader('Server-Timing', buildServerTimingHeader(durationMs));
        } catch {
          /* header al verstuurd — negeren */
        }
      }
      return originalEnd.apply(this, args);
    };
    next();
  });
});

app.use('/api/internal/night-refresh', internalNightRefreshRouter);

app.use('/api/auth', authRouter);
app.use('/api/admin', requireSession, requireAnyRole([ROLES.ADMIN, ROLES.EMPLOYEE]), adminRouter);
app.use('/api/supplier', requireSession, requireAnyRole([ROLES.SUPPLIER, ROLES.EMPLOYEE, 'user']), supplierRouter);
// Generieke Table Builder-data-API — het PO-board draait hier volledig op (po_*-laag verwijderd, #AB:177).
// Staff (admin/employee) heeft volledige toegang; suppliers mogen uitsluitend hun eigen
// purchase-orders lezen (rij-filter op leveranciersaccount in TableDataService.read).
app.use('/api/data', requireSession, restrictSupplierDataAccess, dataRouter);
// BI-grafieken (#AB:218/#AB:219). Staff (admin/employee) zien alle vendors. Suppliers hebben
// read-only toegang en zien uitsluitend hun eigen data: de board-read in bi.js wordt op het
// leveranciersaccount gescoped en schrijf-routes worden voor suppliers geweigerd.
app.use('/api/bi', requireSession, requireAnyRole([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLIER]), biRouter);
// Excel-koppelingen naar hoofdtabellen (#AB:162) — admin-only (upload + fk_join-lookup publiceren).
app.use('/api/data-links', requireSession, requireAnyRole([ROLES.ADMIN, ROLES.EMPLOYEE]), dataLinksRouter);
app.use('/api/rccp', requireSession, requireAnyRole([ROLES.ADMIN, ROLES.EMPLOYEE, ROLES.SUPPLIER]), rccpAccess, rccpRouter);
app.use('/api/media', createMediaRouter());

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');

  // Vite geeft assets een content-hash in de bestandsnaam (index-<hash>.js), dus die zijn
  // veilig lang + immutable te cachen. index.html mag NIET gecachet worden, anders blijft de
  // browser naar oude asset-hashes verwijzen na een deploy.
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use(errorHandler);

// Initialiseer de gedeelde MSSQL-pool één keer bij startup met expliciete pool-grootte.
// Alle modules gebruiken sql.connect(<string>), en mssql's globale connect is "first-call-wins":
// zodra deze pool bestaat, geeft elke latere sql.connect() dezelfde pool terug. Zonder deze init
// wordt de pool met de standaard max=10 aangemaakt, wat onder gelijktijdige gebruikers knelt. We
// hergebruiken mssql's eigen connection-string-parser zodat encrypt/trust/timeouts behouden blijven.
async function initSqlPool() {
  const connStr = process.env.SQL_CONNECTION_STRING;
  if (!connStr) {
    logger.warn('SQL_CONNECTION_STRING ontbreekt; pool-init overgeslagen');
    return;
  }
  const config = sql.ConnectionPool.parseConnectionString(connStr);
  config.pool = {
    ...(config.pool || {}),
    max: parseInt(process.env.SQL_POOL_MAX || '20', 10),
    min: parseInt(process.env.SQL_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.SQL_POOL_IDLE_MS || '30000', 10),
  };
  await sql.connect(config);
  logger.info('MSSQL-pool geïnitialiseerd', { max: config.pool.max, min: config.pool.min });
}

const PORT = process.env.PORT || 3008;
let httpServer = null;
let staleReclaimTimer = null;

function startStaleReclaimLoop() {
  if (staleReclaimTimer) return;
  staleReclaimTimer = setInterval(() => {
    refreshRunService.interruptStaleRunningRows().catch((err) => {
      logger.warn('Stale refresh-run reclaim mislukt', { error: err && err.message ? err.message : String(err) });
    });
  }, 30_000);
  if (typeof staleReclaimTimer.unref === 'function') staleReclaimTimer.unref();
}

function shutdown(signal) {
  logger.info('Server shutdown', { signal });
  if (staleReclaimTimer) {
    clearInterval(staleReclaimTimer);
    staleReclaimTimer = null;
  }
  Promise.resolve(refreshRunService.markInterruptedOnShutdown())
    .catch((err) => {
      logger.warn('Refresh-run shutdown-markering mislukt', { error: err && err.message ? err.message : String(err) });
    })
    .finally(() => {
      if (!httpServer) {
        process.exit(0);
        return;
      }
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 8000).unref();
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Non-fataal: bij een DB-hapering tijdens boot loggen we en starten we alsnog; de modules
// verbinden dan lazy bij de eerste query (met standaard pool-config als fallback).
initSqlPool()
  .then(async () => {
    try {
      await refreshRunService.interruptRunningRowsOnProcessStart();
    } catch (err) {
      logger.warn('Refresh-run interrupt bij process-start mislukt', { error: err && err.message ? err.message : String(err) });
    }
    startStaleReclaimLoop();
    // De board-caches leven in het geheugen van deze container, dus een deploy of een
    // platform-herstart laat ze leeg achter en de eerste bezoeker betaalt de koude read
    // (gemeten op PROD 22-09: 23,9 s tegen ~6,0 s warm). Bewust niet awaiten: de HTTP-server
    // moet meteen luisteren, de read mag op de achtergrond lopen.
    require('./services/BoardWarmup').warmBoardCaches({ reason: 'startup' }).catch(() => {});
  })
  .catch((err) => logger.error('MSSQL-pool init faalde; val terug op lazy connect', { error: err && err.message ? err.message : String(err) }))
  .finally(() => {
    httpServer = app.listen(PORT, () => console.log('Server gestart op poort ' + PORT));
  });

module.exports = app;
