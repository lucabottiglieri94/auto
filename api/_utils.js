const cors = require("cors");

const corsMiddleware = cors({
  origin: "*",
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data, null, 2));
}

function ok(res, data) {
  return json(res, 200, data);
}

function bad(res, message, extra = {}) {
  return json(res, 400, { ok: false, error: message, ...extra });
}

function serverError(res, message, extra = {}) {
  return json(res, 500, { ok: false, error: message, ...extra });
}

function getQuery(req, key) {
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

function normalizeBrand(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function uniqueClean(list) {
  const out = [];
  const seen = new Set();
  for (const x of list || []) {
    const v = String(x || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Cache in-memory (Vercel serverless: best effort, non garantita tra cold start) */
const __cache = new Map();
function cacheGet(key) {
  const item = __cache.get(key);
  if (!item) return null;
  if (Date.now() > item.exp) {
    __cache.delete(key);
    return null;
  }
  return item.val;
}
function cacheSet(key, val, ttlMs) {
  __cache.set(key, { val, exp: Date.now() + ttlMs });
}

function ttlMs() {
  const sec = Number(process.env.CACHE_TTL_SECONDS || "21600");
  return Math.max(60, sec) * 1000;
}

module.exports = {
  corsMiddleware,
  runMiddleware,
  ok,
  bad,
  serverError,
  getQuery,
  normalizeBrand,
  uniqueClean,
  cacheGet,
  cacheSet,
  ttlMs
};
