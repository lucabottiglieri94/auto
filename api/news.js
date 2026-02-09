import * as cheerio from "cheerio";

function applyCors(req, res) {
  const allowed = new Set([
    "https://lucabottiglieri94.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ]);

  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
  res.setHeader("Access-Control-Max-Age", "86400");

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
    const url = "https://www.motorisumotori.it/category/news";
    const r = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });

    if (!r.ok) {
      return res.status(502).json({ items: [], error: "Upstream HTTP " + r.status });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    const items = [];
    const seen = new Set();

    $("h2 a").each((_, a) => {
      if (items.length >= 6) return;

      const title = $(a).text().trim();
      let link = $(a).attr("href") || "";
      if (!title || !link) return;

      if (link.startsWith("/")) link = "https://www.motorisumotori.it" + link;
      if (!link.startsWith("http")) return;

      if (seen.has(link)) return;
      seen.add(link);

      items.push({ title, url: link, date: "" });
    });

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ items: [], error: e?.message || "error" });
  }
}
