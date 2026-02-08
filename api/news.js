import * as cheerio from "cheerio";

export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "https://lucabottiglieri94.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Solo GET
  if (req.method !== "GET") {
    return res.status(405).json({ items: [], error: "Method Not Allowed" });
  }
  // ===== /CORS =====

  try {
    const url = "https://www.motorisumotori.it/category/news";
    const r = await fetch(url, {
      headers: { "user-agent": "AutoAI-NewsBot/1.0 (+https://vercel.com)" }
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

    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ items: [], error: e?.message || "error" });
  }
}
