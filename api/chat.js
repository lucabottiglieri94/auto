export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, searchResults } = req.body;

    // System prompt specializzato per auto
    const systemPrompt = {
      role: 'system',
      content: `Sei un assistente AI esperto di automobili italiane (Fiat, Jeep, Alfa Romeo, Lancia). 
      Aiuti gli utenti a trovare informazioni su modelli, configurazioni, prezzi e caratteristiche.
      
      ${searchResults ? `Ecco informazioni aggiornate dai configuratori:\n${searchResults}` : ''}
      
      Rispondi in italiano in modo professionale ma amichevole. Sii conciso e preciso.`
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Modello veloce e potente
        messages: [systemPrompt, ...messages],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (error) {
    console.error('Error in chat API:', error);
    res.status(500).json({ 
      error: 'Errore nella comunicazione con l\'AI',
      details: error.message 
    });
  }
}
