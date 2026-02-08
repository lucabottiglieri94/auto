import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://www.motorisumotori.it/category/news";
    const r = await fetch(url, {
      headers: { "user-agent": "AutoAI-NewsBot/1.0 (+https://vercel.com)" }
    });

    if (!r.ok) {
      res.statusCode = 502;
      return res.json({ items: [], error: "Upstream HTTP " + r.status });
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
