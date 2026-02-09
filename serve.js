import express from "express";
import cors from "cors";
import Parser from "rss-parser";

const app = express();
const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "AutoNewsBot/1.0 (+https://example.com)"
  }
});

const PORT = process.env.PORT || 3000;
const RSS_URL = process.env.RSS_URL; // <-- metti qui il tuo link RSS
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const LIMIT = clampInt(process.env.LIMIT ?? "24", 1, 80);
const CACHE_MS = clampInt(process.env.CACHE_MS ?? "90000", 0, 10 * 60 * 1000);

if (!RSS_URL) {
  console.error("ERRORE: manca RSS_URL in .env");
}

app.set("trust proxy", 1);

app.use(cors({
  origin: ALLOW_ORIGIN === "*" ? true : ALLOW_ORIGIN,
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

app.get("/health", (req, res) => {
  res.json({ ok: true, rssConfigured: Boolean(RSS_URL) });
});

let cache = { at: 0, data: null };

app.get("/api/news", async (req, res) => {
  try {
    if (!RSS_URL) return res.status(500).json({ error: "RSS_URL non configurato" });

    const now = Date.now();
    if (CACHE_MS > 0 && cache.data && (now - cache.at) < CACHE_MS) {
      return res.json(cache.data);
    }

    const feed = await parser.parseURL(RSS_URL);

    const items = (feed.items || [])
      .slice(0, LIMIT)
      .map((it) => normalizeItem(it, feed))
      .filter(Boolean);

    const payload = {
      source: feed.title || "RSS",
      feedUrl: RSS_URL,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items
    };

    cache = { at: now, data: payload };
    res.setHeader("Cache-Control", "public, max-age=30");
    return res.json(payload);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    return res.status(502).json({
      error: "Impossibile leggere RSS",
      detail: msg
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend online su http://localhost:${PORT}`);
});

function normalizeItem(it, feed) {
  const title = cleanText(it.title);
  const link = pickLink(it);
  if (!title || !link) return null;

  const pubDate = it.isoDate || it.pubDate || null;

  return {
    title,
    link,
    date: pubDate ? new Date(pubDate).toISOString() : null,
    summary: cleanText(it.contentSnippet || it.content || it.summary || ""),
    image: pickImage(it),
    source: cleanText(feed?.title || "")
  };
}

function pickLink(it) {
  if (it.link) return it.link;
  if (Array.isArray(it.links) && it.links[0]) return it.links[0];
  return null;
}

function pickImage(it) {
  // tenta: enclosure, media:content, og:image già presente, ecc.
  if (it.enclosure?.url) return it.enclosure.url;
  const media = it["media:content"] || it["media:thumbnail"];
  if (media?.url) return media.url;
  if (Array.isArray(media) && media[0]?.url) return media[0].url;
  return null;
}

function cleanText(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
