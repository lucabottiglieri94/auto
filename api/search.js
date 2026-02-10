export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // Siti prioritari per info automotive
    const prioritySites = [
      'quattroruote.it/listino',
      'fiat.it',
      'jeep-official.it', 
      'alfaromeo.it',
      'lancia.it',
      'autoblog.it',
      'motorbox.com',
      'auto.it',
      'autoappassionati.it',
      'automoto.it'
    ];

    // Costruisci query ottimizzata
    const siteQuery = prioritySites.slice(0, 6).map(site => `site:${site}`).join(' OR ');
    const enhancedQuery = `${q} (${siteQuery})`;

    console.log('Searching with query:', enhancedQuery);

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(enhancedQuery)}&count=10&freshness=month`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': process.env.BRAVE_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Brave API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    // Estrai e ordina i risultati dando priorità a Quattroruote
    let results = data.web?.results?.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      isQuattroruote: r.url.includes('quattroruote.it'),
      isOfficialBrand: ['fiat.it', 'jeep-official.it', 'alfaromeo.it', 'lancia.it'].some(site => r.url.includes(site))
    })) || [];

    // Ordina: prima Quattroruote, poi siti ufficiali, poi altri
    results.sort((a, b) => {
      if (a.isQuattroruote && !b.isQuattroruote) return -1;
      if (!a.isQuattroruote && b.isQuattroruote) return 1;
      if (a.isOfficialBrand && !b.isOfficialBrand) return -1;
      if (!a.isOfficialBrand && b.isOfficialBrand) return 1;
      return 0;
    });

    // Rimuovi flag interni prima di inviare
    results = results.map(({ isQuattroruote, isOfficialBrand, ...rest }) => rest);

    console.log(`Found ${results.length} results`);

    res.status(200).json({ results });

  } catch (error) {
    console.error('Error in search API:', error);
    res.status(500).json({ 
      error: 'Errore nella ricerca',
      details: error.message 
    });
  }
}
