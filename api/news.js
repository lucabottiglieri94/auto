function applyCors(req, res) {
  const allowedOrigins = new Set([
    "https://lucabottiglieri94.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ]);

  const origin = req.headers.origin;

  // Setta SEMPRE i CORS headers
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
    const feedUrl = "https://www.motor1.com/it/rss/news.xml";  // Nuovo feed affidabile

    const r = await fetch(feedUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "accept-language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });

    if (!r.ok) {
      console.error('Fetch failed:', r.status, r.statusText);
      return res.status(502).json({ items: [], error: "Upstream HTTP " + r.status });
    }

    const xml = await r.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const items = [];
    const seen = new Set();

    $("item").each((_, it) => {
      if (items.length >= 8) return;

      const title = $(it).find("title").first().text().trim();
      const link = $(it).find("link").first().text().trim();
      const pubDate = $(it).find("pubDate").first().text().trim();

      if (!title || !link) return;
      if (!link.startsWith("http")) return;
      if (seen.has(link)) return;
      seen.add(link);

      items.push({ 
        title, 
        url: link, 
        date: pubDate || "" 
      });
    });

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ items });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ items: [], error: e?.message || "Internal error" });
  }
}

