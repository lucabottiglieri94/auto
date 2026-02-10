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

    // Migliora la query aggiungendo contesto automotive
    const enhancedQuery = `${q} site:fiat.it OR site:jeep-official.it OR site:alfaromeo.it OR site:lancia.it configuratore`;

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(enhancedQuery)}&count=5`,
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
    
    // Estrai solo le info utili
    const results = data.web?.results?.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
    })) || [];

    res.status(200).json({ results });

  } catch (error) {
    console.error('Error in search API:', error);
    res.status(500).json({ 
      error: 'Errore nella ricerca',
      details: error.message 
    });
  }
}
