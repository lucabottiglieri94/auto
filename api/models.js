const cheerio = require("cheerio");
const {
  corsMiddleware,
  runMiddleware,
  ok,
  bad,
  serverError,
  getQuery,
  normalizeBrand,
  cacheGet,
  cacheSet,
  ttlMs
} = require("./_utils");

/* ===================== BRAND CONFIG ===================== */
const BRAND_CONFIG = {
  fiat: {
    name: "Fiat",
    site: "https://www.fiat.it/",
    domain: "fiat.it",
    // Fiat ha pattern abbastanza stabile
    urlHints: ["/modello/"],
    fallbackPages: ["https://www.fiat.it/"]
  },
  jeep: {
    name: "Jeep",
    site: "https://www.jeep.it/",
    domain: "jeep.it",
    // Jeep NON ha pattern unico -> accettiamo quasi tutto e filtriamo con regole smart sotto
    urlHints: ["/"],
    fallbackPages: ["https://www.jeep.it/"]
  }
};

// Fallback manuale (solo se non troviamo abbastanza link reali)
const MANUAL_MODELS = {
  fiat: ["600", "500", "500e", "Panda", "Tipo"],
  jeep: ["Avenger", "Renegade", "Compass", "Wrangler", "Grand Cherokee"]
};

/* ===================== HELPERS ===================== */
const BRAND_HOME = {
  fiat: "https://www.fiat.it/",
  jeep: "https://www.jeep.it/"
};

function absUrl(base, href) {
  if (!href) return "";
  const h = String(href).trim();
  try {
    if (/^https?:\/\//i.test(h)) return h;
    if (h.startsWith("//")) return "https:" + h;
    if (h.startsWith("/")) return base.replace(/\/$/, "") + h;
    return new URL(h, base).toString();
  } catch {
    return "";
  }
}

function slugToName(slug) {
  const s = String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanTitleToName(title, brandName) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*\\|\\s*${brandName}.*$`, "i"), "")
    .replace(new RegExp(`\\s*-\\s*${brandName}.*$`, "i"), "")
    .trim();
}

function shapeModels(rawModels, brandId, usedUrl = "") {
  const base = BRAND_HOME[brandId] || usedUrl || "";
  const out = [];

  for (const m of rawModels || []) {
    if (typeof m === "string") {
      const name = m.trim();
      if (name) out.push({ name, url: "" });
      continue;
    }
    if (m && typeof m === "object") {
      const name = String(m.name || m.title || m.label || "").trim();
      const urlRaw = m.url || m.href || m.link || m.permalink || m.pageUrl || "";
      const url = absUrl(base, String(urlRaw || "").trim());
      if (name) out.push({ name, url });
    }
  }

  // dedupe per nome
  const seen = new Set();
  return out.filter((x) => {
    const k = x.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ===================== FILTER URL ===================== */
function isAllowedModelUrl(brandId, url) {
  const cfg = BRAND_CONFIG[brandId];
  if (!cfg) return false;

  const u = String(url || "");
  if (!u.includes(cfg.domain)) return false;

  const low = u.toLowerCase();

  // blocca pagine inutili
  const blocked = [
    "/privacy", "/cookie", "/contatti", "/newsletter",
    "/concessionari", "/assistenza", "/servizi",
    "/finanziamenti", "/promozioni", "/offerte",
    "/usato", "/configuratore", "/sitemap",
    "/accessori", "/shop", "/merch", "/login"
  ];
  if (blocked.some((p) => low.includes(p))) return false;

  // FIAT: regole strette
  if (brandId !== "jeep") {
    return cfg.urlHints.some((h) => low.includes(h));
  }

  // JEEP: regole smart
  const allowKeywords = ["avenger", "renegade", "compass", "wrangler", "cherokee", "grand"];
  if (allowKeywords.some((k) => low.includes("/" + k))) return true;

  // fallback: pagine “pulite” a 1 segmento (es: https://www.jeep.it/avenger/)
  const path = low.replace(/^https?:\/\/[^/]+/i, "");
  const segments = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (segments.length === 1) return true;

  return false;
}

/* ===================== BRAVE SEARCH ===================== */
async function braveSearchModels(brandId) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;

  const cfg = BRAND_CONFIG[brandId];

  // query più permissiva per Jeep
  let q;
  if (brandId === "jeep") {
    q = `site:${cfg.domain} ${cfg.name} (Avenger OR Renegade OR Compass OR Wrangler OR Cherokee)`;
  } else {
    const hints = cfg.urlHints.map((h) => `inurl:${h}`).join(" OR ");
    q = `site:${cfg.domain} (${hints}) ${cfg.name}`;
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", "25");

  const r = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key
    }
  });
  if (!r.ok) return null;

  const data = await r.json();
  const results = data?.web?.results || [];

  const seen = new Set();
  const models = [];

  for (const it of results) {
    const rawUrl = it?.url || "";
    if (!isAllowedModelUrl(brandId, rawUrl)) continue;

    const cleanUrl = rawUrl.split("?")[0];
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    const name =
      cleanTitleToName(it?.title, cfg.name) ||
      slugToName(cleanUrl.split("/").filter(Boolean).pop());

    models.push({ name, url: cleanUrl });
  }

  return models;
}

/* ===================== SCRAPING ===================== */
function toAbsolute(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AutoBackend/1.0)",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return await r.text();
}

function extractModelLinksFromHtml(brandId, pageUrl, html) {
  const $ = cheerio.load(html);

  const out = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const abs = toAbsolute(pageUrl, href);
    if (!abs) return;

    const cleanUrl = abs.split("?")[0];
    if (!isAllowedModelUrl(brandId, cleanUrl)) return;
    if (seen.has(cleanUrl)) return;
    seen.add(cleanUrl);

    const text = $(el).text().replace(/\s+/g, " ").trim();
    const name =
      (text && text.length <= 40 ? text : "") ||
      slugToName(cleanUrl.split("/").filter(Boolean).pop());

    out.push({ name, url: cleanUrl });
  });

  const badNames = new Set(
    ["Gamma", "Modelli", "Auto", "Scopri", "Scopri di più", "Configura"]
      .map((x) => x.toLowerCase())
  );

  return out.filter((m) => {
    const n = String(m.name || "").trim();
    if (n.length < 2 || n.length > 40) return false;
    if (badNames.has(n.toLowerCase())) return false;
    return true;
  });
}

function mergeUniqueByUrl(list) {
  const seen = new Set();
  const out = [];
  for (const x of list || []) {
    const u = (x?.url || "").split("?")[0];
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({
      name: x.name || slugToName(u.split("/").filter(Boolean).pop()),
      url: u
    });
  }
  return out;
}

function ensureMinimum(brandId, models) {
  const cfg = BRAND_CONFIG[brandId];
  const out = [...(models || [])];

  if (out.length < 6) {
    const manual = MANUAL_MODELS[brandId] || [];
    for (const name of manual) {
      if (out.length >= 10) break;
      if (!out.some((m) => (m.name || "").toLowerCase() === name.toLowerCase())) {
        out.push({ name, url: "" });
      }
    }
  }

  return out.slice(0, 25).map((m) => ({
    name: String(m.name || "").trim() || cfg.name,
    url: m.url ? m.url.split("?")[0] : ""
  }));
}

/* ===================== HANDLER ===================== */
module.exports = async (req, res) => {
  try {
    await runMiddleware(req, res, corsMiddleware);
    if (req.method === "OPTIONS") return res.end();

    const brandRaw = getQuery(req, "brand");
    const brandId = normalizeBrand(brandRaw);

    if (!brandId) {
      return bad(res, "Parametro brand mancante. Esempio: /api/models?brand=fiat");
    }

    const cfg = BRAND_CONFIG[brandId];
    if (!cfg) {
      return bad(res, "Brand non supportato", { supported: Object.keys(BRAND_CONFIG) });
    }

    const cacheKey = `models:${brandId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return ok(res, cached);

    let models = [];

    // 1) Brave
    const braveModels = await braveSearchModels(brandId);
    if (braveModels && braveModels.length) {
      models = mergeUniqueByUrl(braveModels);
    }

    // 2) scraping best effort
    if (models.length < 8) {
      for (const page of cfg.fallbackPages) {
        try {
          const html = await fetchHtml(page);
          const extracted = extractModelLinksFromHtml(brandId, page, html);
          models = mergeUniqueByUrl([...models, ...extracted]);
          if (models.length >= 8) break;
        } catch {
          // ignora
        }
      }
    }

    // 3) fallback manuale
    models = ensureMinimum(brandId, models);

    // 4) shape finale: garantisce {name,url} e url assoluti dove presenti
    models = shapeModels(models, brandId, cfg.site);

    const payload = {
      ok: true,
      brand: { id: brandId, name: cfg.name, site: cfg.site },
      source: {
        braveEnabled: Boolean(process.env.BRAVE_API_KEY),
        note:
          "Ritorna sempre {name,url}. Per Jeep usa filtri smart e prova Brave+scraping. Url vuoto solo se non trovato (fallback manuale)."
      },
      models
    };

    cacheSet(cacheKey, payload, ttlMs());
    return ok(res, payload);
  } catch (e) {
    return serverError(res, "Errore backend", { detail: String(e?.message || e) });
  }
};
