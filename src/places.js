import 'dotenv/config';

const PLACES_API_BASE_URL = 'https://places.googleapis.com';

function getApiKey() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY ist nicht gesetzt. Bitte .env.example als .env kopieren und den API-Schlüssel eintragen.');
  }

  return apiKey;
}

async function callPlacesApi(path, options = {}) {
  const apiKey = getApiKey();
  const params = new URLSearchParams(options.queryParams || {});
  const queryString = params.toString();
  const url = queryString ? `${PLACES_API_BASE_URL}${path}?${queryString}` : `${PLACES_API_BASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': options.fieldMask || '*',
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Google Places API Fehler (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}
export async function autocompletePlaces(input, options = {}) {
  const {
    languageCode = 'de',
    regionCode = 'DE',
    locationBias,
    locationRestriction,
    includedPrimaryTypes,
    includedRegionCodes,
    includedType,
    origin,
    sessionToken,
    fieldMask = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
  } = options;
 
  const requestBody = {
    input,
    languageCode,
    regionCode,
    locationBias,
    locationRestriction,
    origin,
    sessionToken,
    includedRegionCodes,
    includedPrimaryTypes,
  };
 
  if (includedType) {
    requestBody.includedPrimaryTypes = [includedType];
  }
 
  return callPlacesApi('/v1/places:autocomplete', {
    method: 'POST',
    fieldMask,
    body: JSON.stringify(requestBody),
  });
}

export async function getPlaceDetails(placeId, options = {}) {
  const {
    languageCode = 'de',
    regionCode = 'DE',
    fieldMask = 'id,displayName,formattedAddress,location,types,websiteUri,nationalPhoneNumber,internationalPhoneNumber,currentOpeningHours,regularOpeningHours',
  } = options;

  const encodedPlaceId = encodeURIComponent(placeId);

  return callPlacesApi(`/v1/places/${encodedPlaceId}`, {
    method: 'GET',
    fieldMask,
    queryParams: {
      languageCode,
      regionCode,
    },
  });
}

export { getApiKey };