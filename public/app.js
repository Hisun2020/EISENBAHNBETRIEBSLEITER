// ===== Tab Switching =====
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

document.addEventListener('DOMContentLoaded', () => {
  checkApiStatus();

  // Places Search
  document.getElementById('places-search-btn').addEventListener('click', searchPlaces);
  document.getElementById('places-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchPlaces();
  });

  // Tracks Search
  document.getElementById('tracks-search-btn').addEventListener('click', searchTracks);
  document.getElementById('state-select').addEventListener('change', () => {
    document.getElementById('tracks-status').textContent = '';
    document.getElementById('tracks-results').innerHTML = '';
  });
});

// ===== API Status =====
async function checkApiStatus() {
  const el = document.getElementById('api-status');
  try {
    const res = await fetch('/api/places/autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'test' }),
    });
    if (res.ok || res.status === 400) {
      el.textContent = '✅ Online (Places API erreichbar)';
      el.className = 'online';
    } else {
      el.textContent = '⚠️ Places API nicht verfügbar';
      el.className = 'offline';
    }
  } catch {
    el.textContent = '❌ Server nicht erreichbar';
    el.className = 'offline';
  }
}

// ===== Tab 1: Google Places =====
let selectedPlaceId = null;

async function searchPlaces() {
  const input = document.getElementById('places-input').value.trim();
  if (!input) return;

  const btn = document.getElementById('places-search-btn');
  btn.disabled = true;
  btn.textContent = 'Suche...';

  const resultsDiv = document.getElementById('places-results');
  const detailsDiv = document.getElementById('places-details');
  resultsDiv.innerHTML = '';
  detailsDiv.innerHTML = '';
  selectedPlaceId = null;

  try {
    const includedType = document.getElementById('places-type').value || undefined;
    const res = await fetch('/api/places/autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, includedType }),
    });
    const data = await res.json();

    if (!res.ok) {
      resultsDiv.innerHTML = `<div class="result-item" style="cursor:default;color:#ef4444;">Fehler: ${data.error?.message || JSON.stringify(data.error)}</div>`;
      return;
    }

    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
      resultsDiv.innerHTML = `<div class="result-item" style="cursor:default;">Keine Ergebnisse gefunden.</div>`;
      return;
    }

    for (const s of suggestions) {
      const pred = s.placePrediction || {};
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div class="name">${pred.text?.text || '(unbekannt)'}</div>`;
      item.addEventListener('click', () => showPlaceDetails(pred.placeId, pred.text?.text));
      resultsDiv.appendChild(item);
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div class="result-item" style="cursor:default;color:#ef4444;">Netzwerkfehler: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suchen';
  }
}

async function showPlaceDetails(placeId, name) {
  if (!placeId) return;
  selectedPlaceId = placeId;

  const detailsDiv = document.getElementById('places-details');
  detailsDiv.innerHTML = '<p style="color:#94a3b8;">Lade Details...</p>';

  try {
    const res = await fetch(`/api/places/details/${encodeURIComponent(placeId)}`);
    const data = await res.json();

    if (!res.ok) {
      detailsDiv.innerHTML = `<p style="color:#ef4444;">Fehler: ${JSON.stringify(data.error)}</p>`;
      return;
    }

    const rows = [
      { label: 'Name', value: data.displayName?.text || '-' },
      { label: 'Adresse', value: data.formattedAddress || '-' },
      { label: 'Koordinaten', value: data.location ? `${data.location.latitude}, ${data.location.longitude}` : '-' },
      { label: 'Typen', value: (data.types || []).join(', ') || '-' },
      { label: 'Website', value: data.websiteUri ? `<a href="${data.websiteUri}" target="_blank">${data.websiteUri}</a>` : '-' },
      { label: 'Telefon', value: data.nationalPhoneNumber || '-' },
      { label: 'International', value: data.internationalPhoneNumber || '-' },
    ];

    const html = rows
      .map(
        (r) =>
          `<div class="row"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`
      )
      .join('');

    detailsDiv.innerHTML = `<h3>Details: ${name || placeId}</h3>${html}`;
  } catch (err) {
    detailsDiv.innerHTML = `<p style="color:#ef4444;">Netzwerkfehler: ${err.message}</p>`;
  }
}

// ===== Tab 2: Industriegleise =====
async function searchTracks() {
  const bundesland = document.getElementById('state-select').value;
  if (!bundesland) {
    document.getElementById('tracks-status').textContent = '⚠️ Bitte wähle ein Bundesland aus.';
    return;
  }

  const btn = document.getElementById('tracks-search-btn');
  btn.disabled = true;
  btn.textContent = 'Suche...';

  const statusDiv = document.getElementById('tracks-status');
  const resultsDiv = document.getElementById('tracks-results');
  statusDiv.textContent = '⏳ Frage Overpass-API an (kann bis zu 60 Sekunden dauern)...';
  resultsDiv.innerHTML = '';

  try {
    const res = await fetch('/api/industrial-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundesland }),
    });
    const data = await res.json();

    if (!res.ok) {
      statusDiv.textContent = `❌ Fehler: ${data.error}`;
      return;
    }

    statusDiv.textContent = `✅ ${data.count} Firmen mit Industriegleisen gefunden in ${data.bundesland}.`;

    if (data.results.length === 0) {
      resultsDiv.innerHTML = '<div class="track-item" style="cursor:default;">Keine Ergebnisse.</div>';
      return;
    }

    for (const r of data.results) {
      const item = document.createElement('div');
      item.className = 'track-item';
      const parts = [
        `Bahn-Typ: ${r.railway}`,
        r.service && `Service: ${r.service}`,
        r.usage && `Nutzung: ${r.usage}`,
        r.operator && `Betreiber: ${r.operator}`,
        r.center && `Koordinaten: ${r.center.lat.toFixed(5)}, ${r.center.lon.toFixed(5)}`,
      ]
        .filter(Boolean)
        .join(' · ');

      item.innerHTML = `<div class="company">${r.company_name}</div><div class="meta">${parts}</div>`;
      resultsDiv.appendChild(item);
    }
  } catch (err) {
    statusDiv.textContent = '❌ Netzwerkfehler';
    resultsDiv.innerHTML = `<div class="track-item" style="cursor:default;color:#ef4444;">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suchen';
  }
}