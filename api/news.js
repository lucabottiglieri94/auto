import * as cheerio from "cheerio";
import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase ENV (PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

function applyCors(req, res) {
  const allowed = new Set([
    "https://lucabottiglieri94.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ]);

  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // niente header = browser blocca, ma evita di aprire a tutti
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ items: [], error: "Method Not Allowed" });
  }

  // Auth: verifica Firebase ID token
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ items: [], error: "Missing token" });

  try {
    initAdmin();
    await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    return res.status(401).json({ items: [], error: "Unauthorized" });
  }

  // Scraping
  try {
    const url = "https://www.motorisumotori.it/category/news";
    const r = await fetch(url, {
      headers: { "user-agent": "AutoAI-NewsBot/1.0 (+https://vercel.com)" },
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
