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
    // Pagina “gamma/modelli” cambia nel tempo: la cerchiamo via Brave se disponibile,
    // altrimenti fallback a una pagina base e a lista manuale.
    fallbackPages: ["https://www.fiat.it/"]
  },
  jeep: {
    name: "Jeep",
    site: "https://www.jeep-official.it/",
    fallbackPages: ["https://www.jeep-official.it/"]
  }
};

// Fallback manuale: ti garantisce sempre output anche se lo scraping non trova niente.
// Aggiorna qui quando vuoi.
const MANUAL_MODELS = {
  fiat: ["600", "500", "500e", "Panda", "Tipo"],
  jeep: ["Avenger", "Renegade", "Compass", "Wrangler", "Grand Cherokee"]
};

async function braveSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");

  const r = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": key
    }
  });

  if (!r.ok) {
    return null;
  }

  const data = await r.json();
  const results = (data?.web?.results || [])
    .map(x => ({ title: x.title, url: x.url, description: x.description }))
    .filter(x => x.url);

  return results;
}

function pickLikelyModelsPage(brandId, results) {
  if (!results || !results.length) return null;

  const domain = brandId === "fiat" ? "fiat.it" : "jeep-official.it";
  const good = results
    .filter(r => r.url.includes(domain))
    .sort((a, b) => {
      const aScore = scoreUrl(a.url);
      const bScore = scoreUrl(b.url);
      return bScore - aScore;
    });

  return good[0]?.url || null;

  function scoreUrl(u) {
    const s = u.toLowerCase();
    let score = 0;
    if (s.includes("modelli")) score += 5;
    if (s.includes("gamma")) score += 4;
    if (s.includes("auto")) score += 2;
    if (s.includes("models")) score += 3;
    return score;
  }
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AutoBackend/1.0)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return await r.text();
}

// Estrazione “best effort”: prende testi di link e headings e prova a ripulire
function extractCandidateNamesFromHtml(html) {
  const $ = cheerio.load(html);

  const texts = [];

  $("a").each((_, el) => {
    const t = $(el).text();
    if (t) texts.push(t);
  });

  $("h1,h2,h3").each((_, el) => {
    const t = $(el).text();
    if (t) texts.push(t);
  });

  const cleaned = texts
    .map(t => t.replace(/\s+/g, " ").trim())
    .filter(t => t.length >= 2 && t.length <= 40)
    .filter(t => !looksLikeMenuJunk(t));

  // Heuristica: tiene parole con lettere/numero, scarta roba generica
  const likely = cleaned.filter(t => /[A-Za-zÀ-ÿ0-9]/.test(t));

  // Ulteriore ripulitura: rimuove duplicati e filtri “troppo comuni”
  const uniq = uniqueClean(likely).filter(t => !tooGeneric(t));

  return uniq;

  function looksLikeMenuJunk(t) {
    const s = t.toLowerCase();
    return (
      s.includes("privacy") ||
      s.includes("cookie") ||
      s.includes("contatti") ||
      s.includes("assistenza") ||
      s.includes("configura") ||
      s.includes("scopri") ||
      s.includes("offerte") ||
      s.includes("promozioni") ||
      s.includes("newsletter") ||
      s.includes("login") ||
      s.includes("menu")
    );
  }

  function tooGeneric(t) {
    const s = t.toLowerCase();
    const bad = [
      "home",
      "gamma",
      "modelli",
      "auto",
      "suv",
      "city car",
      "elettrica",
      "ibrida",
      "nuovo",
      "nuova",
      "scopri di più",
      "scopri",
      "configura",
      "vai",
      "clicca"
    ];
    return bad.includes(s);
  }
}

function pickTopModels(brandId, candidates) {
  // Qui facciamo un compromesso: prendiamo massimo 25 voci “sensate”
  // e se non troviamo abbastanza, aggiungiamo il fallback manuale.
  const max = 25;

  const filtered = candidates
    .filter(x => x.length <= 30)
    .filter(x => !/^\d{4}$/.test(x)); // scarta anni

  let models = filtered.slice(0, max);

  // Se lo scraping è “debole”, integra manuale
  const manual = MANUAL_MODELS[brandId] || [];
  for (const m of manual) {
    if (models.length >= max) break;
    if (!models.some(x => x.toLowerCase() === m.toLowerCase())) {
      models.push(m);
    }
  }

  return uniqueClean(models);
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

    // 1) Provo a trovare una pagina modelli via Brave (se hai la chiave)
    let sourceUrl = null;
    const brave = await braveSearch(`${cfg.name} modelli sito ufficiale`);
    sourceUrl = pickLikelyModelsPage(brandId, brave);

    // 2) Se niente Brave, uso fallback pages
    const pages = sourceUrl ? [sourceUrl, ...cfg.fallbackPages] : cfg.fallbackPages;

    let allCandidates = [];
    let usedUrl = null;

    for (const url of pages) {
      try {
        const html = await fetchHtml(url);
        const candidates = extractCandidateNamesFromHtml(html);

        // Se troviamo abbastanza roba, usciamo
        allCandidates = candidates;
        usedUrl = url;
        if (candidates.length >= 8) break;
      } catch {
        // ignora e continua
      }
    }

    const models = pickTopModels(brandId, allCandidates);

    const payload = {
      ok: true,
      brand: { id: brandId, name: cfg.name, site: cfg.site },
      source: {
        usedUrl: usedUrl || null,
        braveEnabled: Boolean(process.env.BRAVE_API_KEY),
        note:
          "Estrazione automatica best-effort. Se vuoi lista perfetta e stabile, aggiorna MANUAL_MODELS in api/models.js oppure integra scraping mirato per ogni brand."
      },
      models
    };

    cacheSet(cacheKey, payload, ttlMs());
    return ok(res, payload);
  } catch (e) {
    return serverError(res, "Errore backend", { detail: String(e?.message || e) });
  }
};
