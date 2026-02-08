const {
  corsMiddleware,
  runMiddleware,
  ok
} = require("./_utils");

/**
 * News: per ora è placeholder.
 * Poi la colleghi a un feed RSS, a un CMS, o a una tabella Firestore.
 */
module.exports = async (req, res) => {
  await runMiddleware(req, res, corsMiddleware);
  if (req.method === "OPTIONS") return res.end();

  const news = [
    {
      id: "welcome",
      title: "News auto: backend attivo",
      date: new Date().toISOString().slice(0, 10),
      summary: "Endpoint /api/news funzionante. Collega qui le notizie della home.",
      url: null
    }
  ];

  return ok(res, { ok: true, news });
};
