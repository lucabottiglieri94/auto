// ===============================================
// BACKEND NODEJS PER AI BOTT AUTOMOTIVE
// Con scraper CentroAuto e database auto usate
// ===============================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ============ DATABASE AUTO USATE ============
const DB_PATH = path.join(__dirname, 'cars-database.json');

// Inizializza database
async function initDatabase() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({
      lastUpdate: null,
      cars: []
    }, null, 2));
  }
}

// Leggi database
async function readDatabase() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

// Salva database
async function saveDatabase(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ============ SCRAPER CENTROAUTO ============

async function scrapeCentroAutoPage(url, brand = null) {
  try {
    console.log(`📡 Scraping: ${url}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const cars = [];

    // Trova tutti i link alle singole auto
    $('a[href*="/ricerca-auto/"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.includes('/usate/') && !href.endsWith('/usate/')) {
        const fullUrl = href.startsWith('http') ? href : `https://www.centroautovt.it${href}`;
        if (!cars.find(c => c.url === fullUrl)) {
          cars.push({ url: fullUrl });
        }
      }
    });

    console.log(`✅ Trovati ${cars.length} link auto su ${url}`);
    return cars;

  } catch (error) {
    console.error(`❌ Errore scraping ${url}:`, error.message);
    return [];
  }
}

async function scrapeCarDetails(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    
    // Estrai titolo
    let title = $('h1').first().text().trim() || 
                $('.car-title').text().trim() ||
                $('title').text().split('|')[0].trim();

    // Estrai dettagli
    const details = {
      url,
      title,
      brand: '',
      model: '',
      price: '',
      year: '',
      km: '',
      fuel: '',
      transmission: '',
      hp: '',
      color: '',
      doors: '',
      bodyType: '',
      features: [],
      description: '',
      images: [],
      lastUpdated: new Date().toISOString()
    };

    // Cerca il prezzo
    $('*').each((i, elem) => {
      const text = $(elem).text();
      const priceMatch = text.match(/€\s*([\d.]+)/);
      if (priceMatch && !details.price) {
        details.price = priceMatch[0];
      }
    });

    // Cerca caratteristiche tecniche
    $('*').each((i, elem) => {
      const text = $(elem).text().trim();
      
      // Anno
      if (text.match(/Immatricolazione:\s*(\d{1,2}\/\d{4})/)) {
        details.year = text.match(/Immatricolazione:\s*(\d{1,2}\/\d{4})/)[1];
      }
      
      // Km
      if (text.match(/(\d+[\.,]?\d*)\s*Km/i)) {
        details.km = text.match(/(\d+[\.,]?\d*)\s*Km/i)[1] + ' Km';
      }
      
      // Carburante
      if (/(Benzina|Gasolio|Diesel|Ibrida|Elettrica|GPL|Metano)/i.test(text)) {
        const fuelMatch = text.match(/(Benzina|Gasolio|Diesel|Ibrida|Elettrica|GPL|Metano)/i);
        if (fuelMatch && !details.fuel) details.fuel = fuelMatch[1];
      }
      
      // Cambio
      if (/(Manuale|Automatico)/i.test(text)) {
        const transMatch = text.match(/(Manuale|Automatico)/i);
        if (transMatch && !details.transmission) details.transmission = transMatch[1];
      }
      
      // CV
      if (text.match(/(\d+)\s*CV/)) {
        details.hp = text.match(/(\d+)\s*CV/)[0];
      }
      
      // Colore
      if (/(Bianco|Nero|Grigio|Rosso|Blu|Verde|Giallo|Arancione|Argento)\s*(Metallizzato|Pastello)?/i.test(text)) {
        const colorMatch = text.match(/(Bianco|Nero|Grigio|Rosso|Blu|Verde|Giallo|Arancione|Argento)\s*(Metallizzato|Pastello)?/i);
        if (colorMatch && !details.color) details.color = colorMatch[0];
      }
      
      // Porte
      if (text.match(/(\d+)\s*porte/i)) {
        details.doors = text.match(/(\d+)\s*porte/i)[1] + ' porte';
      }
      
      // Tipo carrozzeria
      if (/(SUV|Berlina|City Car|Crossover|Station Wagon|Cabrio|Furgone)/i.test(text)) {
        const bodyMatch = text.match(/(SUV|Berlina|City Car|Crossover|Station Wagon|Cabrio|Furgone)/i);
        if (bodyMatch && !details.bodyType) details.bodyType = bodyMatch[1];
      }
    });

    // Estrai brand e model dal titolo
    const brandMatches = title.match(/^(FIAT|JEEP|ALFA ROMEO|LANCIA|FORD|MAZDA|KIA|PEUGEOT|RENAULT|OPEL|VOLKSWAGEN|MG|LAND ROVER|SEAT|SMART|SUZUKI|TOYOTA|CITROEN|DS|AUDI|BMW|MERCEDES|VOLVO|HYUNDAI|NISSAN)/i);
    if (brandMatches) {
      details.brand = brandMatches[1].toUpperCase();
      details.model = title.replace(details.brand, '').trim();
    }

    // Estrai immagini
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && (src.includes('vehicle') || src.includes('auto') || src.includes('car'))) {
        const fullSrc = src.startsWith('http') ? src : `https://www.centroautovt.it${src}`;
        if (!details.images.includes(fullSrc)) {
          details.images.push(fullSrc);
        }
      }
    });

    // Estrai features/accessori
    $('li, .feature, .equipment').each((i, elem) => {
      const feature = $(elem).text().trim();
      if (feature && feature.length > 3 && feature.length < 100) {
        details.features.push(feature);
      }
    });

    console.log(`✅ Estratti dettagli per: ${details.title}`);
    return details;

  } catch (error) {
    console.error(`❌ Errore estrazione dettagli da ${url}:`, error.message);
    return null;
  }
}

async function scrapeAllUsedCars() {
  console.log('🚀 AVVIO SCRAPING COMPLETO CENTROAUTO...\n');
  
  const brands = [
    'fiat', 'jeep', 'alfa-romeo', 'lancia', 'ford', 'mazda', 
    'kia', 'land-rover', 'peugeot', 'renault', 'opel', 
    'volkswagen', 'mg', 'seat', 'smart', 'suzuki', 'citroen'
  ];

  let allCarUrls = [];

  // Step 1: Raccogli tutti i link
  for (const brand of brands) {
    const urls = [
      `https://www.centroautovt.it/ricerca-auto/usate/${brand}/`,
      `https://www.centroautovt.it/ricerca-auto/usate/${brand}/?page=2`,
      `https://www.centroautovt.it/ricerca-auto/usate/${brand}/?page=3`
    ];

    for (const url of urls) {
      const cars = await scrapeCentroAutoPage(url, brand);
      allCarUrls.push(...cars);
      await new Promise(resolve => setTimeout(resolve, 500)); // Delay per non sovraccaricare
    }
  }

  // Rimuovi duplicati
  allCarUrls = [...new Set(allCarUrls.map(c => c.url))].map(url => ({ url }));
  console.log(`\n📊 Totale URL unici trovati: ${allCarUrls.length}\n`);

  // Step 2: Estrai dettagli da ogni auto
  const carsWithDetails = [];
  for (let i = 0; i < allCarUrls.length; i++) {
    console.log(`[${i + 1}/${allCarUrls.length}] Processing...`);
    const details = await scrapeCarDetails(allCarUrls[i].url);
    if (details && details.price) {
      carsWithDetails.push(details);
    }
    await new Promise(resolve => setTimeout(resolve, 800)); // Delay
    
    // Salva ogni 10 auto
    if ((i + 1) % 10 === 0) {
      await saveDatabase({
        lastUpdate: new Date().toISOString(),
        cars: carsWithDetails
      });
      console.log(`💾 Checkpoint: ${carsWithDetails.length} auto salvate`);
    }
  }

  // Salvataggio finale
  await saveDatabase({
    lastUpdate: new Date().toISOString(),
    cars: carsWithDetails
  });

  console.log(`\n✅ SCRAPING COMPLETATO!`);
  console.log(`📊 Auto nel database: ${carsWithDetails.length}`);
  return carsWithDetails;
}

// ============ ENDPOINTS API ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ottieni tutte le auto usate
app.get('/api/used-cars', async (req, res) => {
  try {
    const db = await readDatabase();
    const { brand, model, minPrice, maxPrice, minYear, maxYear } = req.query;
    
    let filteredCars = db.cars;

    if (brand) {
      filteredCars = filteredCars.filter(car => 
        car.brand.toLowerCase() === brand.toLowerCase()
      );
    }

    if (model) {
      filteredCars = filteredCars.filter(car => 
        car.model.toLowerCase().includes(model.toLowerCase())
      );
    }

    res.json({
      success: true,
      lastUpdate: db.lastUpdate,
      count: filteredCars.length,
      cars: filteredCars
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cerca auto usate (per l'AI)
app.post('/api/search-used-cars', async (req, res) => {
  try {
    const { query } = req.body;
    const db = await readDatabase();
    
    const lowerQuery = query.toLowerCase();
    
    // Filtra le auto in base alla query
    const results = db.cars.filter(car => {
      const searchText = `${car.title} ${car.brand} ${car.model} ${car.fuel} ${car.color} ${car.bodyType}`.toLowerCase();
      
      // Cerca parole chiave
      const keywords = lowerQuery.split(' ').filter(w => w.length > 2);
      return keywords.some(keyword => searchText.includes(keyword));
    });

    res.json({
      success: true,
      query,
      count: results.length,
      cars: results.slice(0, 10) // Massimo 10 risultati
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Avvia scraping manuale
app.post('/api/scrape-now', async (req, res) => {
  try {
    res.json({ success: true, message: 'Scraping avviato in background' });
    
    // Esegui in background
    scrapeAllUsedCars().catch(err => {
      console.error('Errore scraping:', err);
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ottieni info database
app.get('/api/db-info', async (req, res) => {
  try {
    const db = await readDatabase();
    
    // Statistiche
    const stats = {
      totalCars: db.cars.length,
      lastUpdate: db.lastUpdate,
      brands: {},
      fuelTypes: {},
      avgPrice: 0
    };

    let totalPrice = 0;
    let priceCount = 0;

    db.cars.forEach(car => {
      // Count by brand
      stats.brands[car.brand] = (stats.brands[car.brand] || 0) + 1;
      
      // Count by fuel
      if (car.fuel) {
        stats.fuelTypes[car.fuel] = (stats.fuelTypes[car.fuel] || 0) + 1;
      }

      // Calculate average price
      if (car.price) {
        const priceNum = parseFloat(car.price.replace(/[^\d]/g, ''));
        if (!isNaN(priceNum)) {
          totalPrice += priceNum;
          priceCount++;
        }
      }
    });

    if (priceCount > 0) {
      stats.avgPrice = Math.round(totalPrice / priceCount);
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Chat endpoint (proxy a OpenAI/Anthropic)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    // Qui dovresti fare la chiamata al tuo LLM (OpenAI, Anthropic, ecc)
    // Per ora ritorno un messaggio di esempio
    
    res.json({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Servizio chat attivo. Integrare con LLM API.'
        }
      }]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ AVVIO SERVER ============

async function startServer() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`\n🚀 SERVER AVVIATO su porta ${PORT}`);
    console.log(`📡 Endpoints disponibili:`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/used-cars`);
    console.log(`   POST /api/search-used-cars`);
    console.log(`   POST /api/scrape-now`);
    console.log(`   GET  /api/db-info`);
    console.log(`   POST /api/chat`);
    
    // Auto-scraping ogni 6 ore
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    setInterval(async () => {
      console.log('\n⏰ Auto-scraping programmato...');
      await scrapeAllUsedCars();
    }, SIX_HOURS);
    
    console.log(`\n⏰ Auto-scraping attivato ogni 6 ore`);
    console.log(`\n💡 Avvia primo scraping con: POST /api/scrape-now\n`);
  });
}

startServer();
