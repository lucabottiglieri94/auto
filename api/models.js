const cheerio = require("cheerio");
const {
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
} = require("./_utils");

// Config marchi → siti ufficiali
const BRAND_CONFIG = {
  fiat: {
    name: "Fiat",
    site: "https://www.fiat.it/",
    domain: "fiat.it",
    urlHints: ["/modello/"], // Fiat: pagine modello tipicamente qui
    fallbackPages: ["https://www.fiat.it/"]
  },
  jeep: {
    name: "Jeep",
    site: "https://www.jeep-official.it/",
    domain: "jeep-official.it",
    urlHints: ["/modelli/", "/modello/"], // Jeep: spesso /modelli/ ma teniamo anche /modello/
    fallbackPages: ["https://www.jeep-official.it/"]
  }
};

// Fallback manuale (usato solo se non troviamo abbastanza link reali)
const MANUAL_MODELS = {
  fiat: ["600", "500", "500e", "Panda", "Tipo"],
  jeep: ["Avenger", "Renegade", "Compass", "Wrangler", "Grand Cherokee"]
};

function isAllowedModelUrl(brandId, url) {
  const cfg = BRAND_CONFIG[brandId];
  if (!cfg) return false;
  const u = String(url || "");
  if (!u.includes(cfg.domain)) return false;
  const low = u.toLowerCase();
  return cfg.urlHints.some(h => low.includes(h));
}

function cleanTitleToName(title, brandName) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*\\|\\s*${brandName}.*$`, "i"), "")
    .replace(new RegExp(`\\s*-\\s*${brandName}.*$`, "i"), "")
    .trim();
}

function slugToName(slug) {
  const s = String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function braveSearchModels(brandId) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;

  const cfg = BRAND_CONFIG[brandId];
  const hints = cfg.urlHints.map(h => `inurl:${h}`).join(" OR ");
  const q = `site:${cfg.domain} (${hints}) ${cfg.name}`;

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

// Estrae link veri a pagine modello dal DOM
function extractModelLinksFromHtml(brandId, pageUrl, html) {
  const cfg = BRAND_CONFIG[brandId];
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
    const name = (text && text.length <= 40 ? text : "") ||
      slugToName(cleanUrl.split("/").filter(Boolean).pop());

    out.push({ name, url: cleanUrl });
  });

  // ripulisce nomi troppo generici
  const badNames = new Set([
    "Gamma", "Modelli", "Auto", "Scopri", "Scopri di più", "Configura"
  ].map(x => x.toLowerCase()));

  return out.filter(m => {
    const n = String(m.name || "").trim();
    if (n.length < 2 || n.length > 40) return false;
    if (badNames.has(n.toLowerCase())) return false;
    return true;
  });
}

function mergeUniqueByUrl(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const u = (x?.url || "").split("?")[0];
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({ name: x.name || slugToName(u.split("/").filter(Boolean).pop()), url: u });
  }
  return out;
}

function ensureMinimum(brandId, models) {
  const cfg = BRAND_CONFIG[brandId];
  const out = [...models];

  // se mancano modelli, aggiunge fallback SOLO come nome (senza url certa)
  // (il frontend li renderà come chip non cliccabile)
  if (out.length < 6) {
    const manual = MANUAL_MODELS[brandId] || [];
    for (const name of manual) {
      if (out.length >= 10) break;
      if (!out.some(m => (m.name || "").toLowerCase() === name.toLowerCase())) {
        out.push({ name, url: "" });
      }
    }
  }

  // taglia max
  return out.slice(0, 25).map(m => ({
    name: String(m.name || "").trim() || cfg.name,
    url: m.url ? m.url.split("?")[0] : ""
  }));
}

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

    // 1) Brave (se presente) → migliore perché già dà URL modello
    const braveModels = await braveSearchModels(brandId);
    if (braveModels && braveModels.length) {
      models = mergeUniqueByUrl(braveModels);
    }

    // 2) Se Brave non basta → scraping “best effort” dai link del sito
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

    models = ensureMinimum(brandId, models);

    const payload = {
      ok: true,
      brand: { id: brandId, name: cfg.name, site: cfg.site },
      source: {
        braveEnabled: Boolean(process.env.BRAVE_API_KEY),
        note:
          "Ritorna {name,url} quando trova pagine modello. Se Brave non è attivo o il sito cambia struttura, alcuni fallback possono uscire senza url."
      },
      models
    };

    cacheSet(cacheKey, payload, ttlMs());
    return ok(res, payload);
  } catch (e) {
    return serverError(res, "Errore backend", { detail: String(e?.message || e) });
  }
};
