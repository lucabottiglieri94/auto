import * as cheerio from "cheerio";

function applyCors(req, res) {
  const allowedOrigins = new Set([
    "https://lucabottiglieri94.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ]);

  const origin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Origin", allowedOrigins.has(origin) ? origin : "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ items: [], error: "Method Not Allowed" });
  }

  try {
    // ✅ Feed corretto Motor1 Italia
    const feedUrl = "https://it.motor1.com/rss/news/all/";

    const r = await fetch(feedUrl, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "accept-language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({
        items: [],
        error: "Upstream HTTP " + r.status,
        detail: txt.slice(0, 180),
      });
    }

    const xml = await r.text();

    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];
    const seen = new Set();

    $("item").each((_, it) => {
      if (items.length >= 12) return;

      const title = $(it).
