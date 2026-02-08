const { corsMiddleware, runMiddleware, ok } = require("./_utils");

module.exports = async (req, res) => {
  await runMiddleware(req, res, corsMiddleware);
  if (req.method === "OPTIONS") return res.end();

  // Qui aggiungi/editi marchi
  const brands = [
    { id: "fiat", name: "Fiat", site: "https://www.fiat.it/" },
    { id: "jeep", name: "Jeep", site: "https://www.jeep-official.it/" }
  ];

  return ok(res, { ok: true, brands });
};
