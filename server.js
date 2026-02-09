import express from "express";
import Parser from "rss-parser";

const app = express();
const parser = new Parser({ timeout: 12000 });

const RSS_URL = process.env.RSS_URL;
const LIMIT = Math.max(1, Math.min(parseInt(process.env.LIMIT || "24", 10), 80));
const CACHE_MS = Math.max(0, Math.min(parseInt(process.env.CACHE_MS || "90000", 10), 10 * 60 * 1000));

// Metti qui il tuo dominio GitHub Pages (consigliato) oppure "*"
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "https://lucabottiglieri94.github.io";

// ---------- CORS FIX (include preflight + Authorization) ----------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN === "*" ? "*" : ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ---------- Routes ----------
app.get("/api/news", async (req, res) => {
  try {
    if (!RSS_URL) return res.status(500).json({ error: "RSS_URL non configurato" });

    // cache semplice in memoria
    const now = Date.now();
    if (globalThis.__newsCache && (now - globalThis.__newsCache.at) < CACHE_MS) {
      return res.json(globalThis.__newsCache.data);
    }

    const feed = await parser.parseURL(RSS_URL);

    const items = (feed.items || []).slice(0, LIMIT).map((it) => ({
      title: it.title || "",
      link: it.link || "",
      date: it.isoDate || it.pubDate || null,
      summary: (it.contentSnippet || it.content || it.summary || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      image: it.enclosure?.url || it["media:content"]?.url || it["media:thumbnail"]?.url || null,
      source: feed.title || ""
    })).filter(x => x.title && x.link);

    const payload = {
      source: feed.title || "RSS",
      feedUrl: RSS_URL,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items
    };

    globalThis.__newsCache = { at: now, data: payload };
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: "Impossibile leggere RSS", detail: e?.message || String(e) });
  }
});

// ---------- Vercel handler ----------
export default app;

// ---------- Local dev ----------
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log("Local on http://localhost:" + PORT));
}
