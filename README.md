# Auto Backend (Vercel)

API endpoints:

- GET /api/brands
- GET /api/models?brand=fiat
- GET /api/models?brand=jeep
- GET /api/news

Note:
- /api/models fa un'estrazione best-effort dal sito ufficiale.
- Se vuoi risultati perfetti e stabili, aggiorna MANUAL_MODELS in api/models.js
- Per migliorare la ricerca automatica, imposta BRAVE_API_KEY su Vercel (Environment Variables).
