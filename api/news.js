// FILE: /api/news.js  (Vercel Serverless Function)
// npm i cheerio

import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://www.motorisumotori.it/category/news";
    const r = await fetch(url, {
      headers: {
        "user-agent": "AutoAI-NewsBot/1.0 (+https://vercel.com)"
      }
    });
    if (!r.ok) {
      res.statusCode = 502;
      return res.json({ items: [], error: "Upstream HTTP " + r.status });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // Prende i primi H2 con link (titoli articoli) nella pagina categoria
    const items = [];
    const seen = new Set();

    $("h2 a").each((_, a) => {
      if (items.length >= 6) return;

      const title = $(a).text().trim();
      let link = $(a).attr("href") || "";
      if (!title || !link) return;

      // Normalizza URL
      if (link.startsWith("/")) link = "https://www.motorisumotori.it" + link;
      if (!link.startsWith("http")) return;

      if (seen.has(link)) return;
      seen.add(link);

      // prova a trovare una data vicino al titolo (nel contenitore più vicino)
      const container = $(a).closest("article, .post, .td_module_10, .td_module_2, .tdb_module_loop, div");
      const textAround = container.text().replace(/\s+/g, " ").trim();

      // match tipo: "2 Febbraio 2026"
      const m = textAround.match(/\b(\d{1,2})\s+(Gennaio|Febbraio|Marzo|Aprile|Maggio|Giugno|Luglio|Agosto|Settembre|Ottobre|Novembre|Dicembre)\s+(\d{4})\b/i);
      const date = m ? m[0] : "";

      items.push({ title, url: link, date });
    });

    // Cache CDN 12h
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ items: [], error: e?.message || "error" });
  }
}
