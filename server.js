import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const PLACES_API_BASE_URL = 'https://places.googleapis.com';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- Google Places API ---

function getApiKey() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY ist nicht gesetzt.');
  }
  return apiKey;
}

app.post('/api/places/autocomplete', async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { input, ...options } = req.body;
    const requestBody = {
      input,
      languageCode: options.languageCode || 'de',
      regionCode: options.regionCode || 'DE',
      includedPrimaryTypes: options.includedType ? [options.includedType] : undefined,
    };

    const fieldMask = options.fieldMask || 'suggestions.placePrediction.placeId,suggestions.placePrediction.text';

    const response = await fetch(`${PLACES_API_BASE_URL}/v1/places:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(requestBody),
    });

    const body = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: body });
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/places/details/:placeId', async (req, res) => {
  try {
    const apiKey = getApiKey();
    const { placeId } = req.params;
    const languageCode = req.query.languageCode || 'de';
    const regionCode = req.query.regionCode || 'DE';
    const fieldMask = req.query.fieldMask || 'id,displayName,formattedAddress,location,types,websiteUri,nationalPhoneNumber,internationalPhoneNumber,currentOpeningHours,regularOpeningHours';

    const response = await fetch(`${PLACES_API_BASE_URL}/v1/places/${encodeURIComponent(placeId)}?languageCode=${languageCode}&regionCode=${regionCode}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
    });

    const body = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: body });
    }
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Overpass API (Industriegleise) ---

const FEDERAL_STATE_AREA_IDS = {
  'baden-wuerttemberg': '3600062427',
  'bayern': '3600062428',
  'berlin': '3600062422',
  'brandenburg': '3600062429',
  'bremen': '3600062431',
  'hamburg': '3600062421',
  'hessen': '3600062419',
  'mecklenburg-vorpommern': '3600062430',
  'niedersachsen': '3600062432',
  'nordrhein-westfalen': '3600062417',
  'rheinland-pfalz': '3600062418',
  'saarland': '3600062420',
  'sachsen': '3600062424',
  'sachsen-anhalt': '3600062423',
  'schleswig-holstein': '3600062425',
  'thueringen': '3600062426',
};

app.post('/api/industrial-tracks', async (req, res) => {
  try {
    const { bundesland } = req.body;
    if (!bundesland) {
      return res.status(400).json({ error: 'Bundesland ist erforderlich.' });
    }

    const normalized = bundesland.trim().toLowerCase().replace(/ü/g, 'ue').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/_/g, '-');
    const areaId = FEDERAL_STATE_AREA_IDS[normalized];

    if (!areaId) {
      return res.status(400).json({ error: `Unbekanntes Bundesland: ${bundesland}`, available: Object.keys(FEDERAL_STATE_AREA_IDS) });
    }

    const query = `
      [out:json][timeout:60];
      area(${areaId})->.state;
      (
        way["railway"~"^(service|industrial|yard)$"](area.state);
        way["railway"="rail"]["usage"="industrial"](area.state);
      );
      out center tags geom(50);
    `;

    const overpassResponse = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    });

    const data = await overpassResponse.json();

    // Extrahiere Firmen mit Industriegleisen
    const filterWords = ['anschlussgleis', 'industriegleis', 'gleisanschluss', 'anschlussbahn', 'hafenbahn', 'werksbahn', 'rangiergleis', 'ladegleis', 'industrie', 'industrial', 'werk', 'güterverkehr', 'gueterverkehr', 'container', 'logistik', 'terminal'];
    const ignoreNameParts = ['deutsche bahn', 'db netz', 'db infra', 'db station&service', 's-bahn', 'straßenbahn', 'stadtbahn', 'tram', 'u-bahn'];

    const results = [];

    for (const element of data.elements || []) {
      const tags = element.tags || {};

      // Lebenszyklus-Tag?
      const lifecycleKeys = ['disused', 'abandoned', 'dismantled', 'demolished', 'razed', 'proposed', 'construction'];
      let hasLifecycle = false;
      for (const key of Object.keys(tags)) {
        const k = key.toLowerCase();
        const v = (tags[key] || '').toLowerCase();
        if (lifecycleKeys.includes(k) || lifecycleKeys.includes(v) || k.startsWith('disused:') || k.startsWith('abandoned:')) {
          hasLifecycle = true;
          break;
        }
      }
      if (hasLifecycle) continue;

      const railway = (tags.railway || '').toLowerCase();
      const service = (tags.service || '').toLowerCase();
      const usage = (tags.usage || '').toLowerCase();
      const name = (tags.name || '').toLowerCase();
      const operator = (tags.operator || '').toLowerCase();
      const industrial = (tags.industrial || '').toLowerCase();
      const description = (tags.description || '').toLowerCase();

      const haystack = [railway, service, usage, operator, name, description, industrial].join(' ');

      // Ignorieren wenn Betreiber DB ist und keine Filterwörter vorkommen
      if (operator && ignoreNameParts.some(p => operator.includes(p)) && !filterWords.some(w => haystack.includes(w))) continue;

      let isIndustrial = false;
      if (railway === 'industrial') isIndustrial = true;
      else if (usage.includes('industrial') || service.includes('industrial') || industrial.includes('industrial')) isIndustrial = true;
      else if (railway === 'service' && ['spur', 'siding', 'yard'].includes(service)) isIndustrial = true;
      else if (filterWords.some(w => haystack.includes(w))) isIndustrial = true;

      if (!isIndustrial) continue;

      // Firmenname extrahieren
      let companyName = tags.name || tags.operator || tags.brand || tags.owner || tags['addr:street'] || industrial || '';
      companyName = companyName.trim();
      if (!companyName) continue;

      results.push({
        company_name: companyName,
        railway, service, usage,
        operator: tags.operator || '',
        name: tags.name || '',
        id: element.id,
        type: element.type,
        center: element.center || null,
      });
    }

    // Sortieren & Duplikate entfernen
    results.sort((a, b) => a.company_name.toLowerCase().localeCompare(b.company_name.toLowerCase()));
    const unique = [];
    const seen = new Set();
    for (const item of results) {
      const key = item.company_name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    res.json({ count: unique.length, bundesland, results: unique });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});