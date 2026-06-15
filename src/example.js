import { autocompletePlaces, getPlaceDetails, getApiKey } from './places.js';

console.log('Google Places API ist konfiguriert.');

try {
  getApiKey();

  const suggestions = await autocompletePlaces('Berlin Hauptbahnhof', {
    includedType: 'train_station',
  });

  console.log('Autocomplete-Ergebnisse:', suggestions);

  const firstPlaceId = suggestions.suggestions?.[0]?.placePrediction?.placeId;

  if (firstPlaceId) {
    const details = await getPlaceDetails(firstPlaceId);
    console.log('Details:', details);
  }
} catch (error) {
  console.error(error.message);
}