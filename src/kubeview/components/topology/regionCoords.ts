/**
 * Cloud region → geographic coordinates lookup.
 * Covers AWS, Azure, GCP, and IBM Cloud regions.
 * Used to place clusters on the world map.
 */

interface RegionCoord {
  latitude: number;
  longitude: number;
  displayName: string;
}

const REGION_COORDS: Record<string, RegionCoord> = {
  // AWS
  'us-east-1':      { latitude: 39.0, longitude: -77.5, displayName: 'N. Virginia' },
  'us-east-2':      { latitude: 40.0, longitude: -83.0, displayName: 'Ohio' },
  'us-west-1':      { latitude: 37.3, longitude: -121.9, displayName: 'N. California' },
  'us-west-2':      { latitude: 46.2, longitude: -123.8, displayName: 'Oregon' },
  'ca-central-1':   { latitude: 45.5, longitude: -73.6, displayName: 'Canada' },
  'eu-west-1':      { latitude: 53.3, longitude: -6.3, displayName: 'Ireland' },
  'eu-west-2':      { latitude: 51.5, longitude: -0.1, displayName: 'London' },
  'eu-west-3':      { latitude: 48.9, longitude: 2.3, displayName: 'Paris' },
  'eu-central-1':   { latitude: 50.1, longitude: 8.7, displayName: 'Frankfurt' },
  'eu-central-2':   { latitude: 47.4, longitude: 8.5, displayName: 'Zurich' },
  'eu-north-1':     { latitude: 59.3, longitude: 18.1, displayName: 'Stockholm' },
  'eu-south-1':     { latitude: 45.5, longitude: 9.2, displayName: 'Milan' },
  'ap-southeast-1': { latitude: 1.3, longitude: 103.8, displayName: 'Singapore' },
  'ap-southeast-2': { latitude: -33.9, longitude: 151.2, displayName: 'Sydney' },
  'ap-northeast-1': { latitude: 35.7, longitude: 139.7, displayName: 'Tokyo' },
  'ap-northeast-2': { latitude: 37.6, longitude: 127.0, displayName: 'Seoul' },
  'ap-northeast-3': { latitude: 34.7, longitude: 135.5, displayName: 'Osaka' },
  'ap-south-1':     { latitude: 19.1, longitude: 72.9, displayName: 'Mumbai' },
  'ap-south-2':     { latitude: 17.4, longitude: 78.5, displayName: 'Hyderabad' },
  'sa-east-1':      { latitude: -23.6, longitude: -46.6, displayName: 'Sao Paulo' },
  'me-south-1':     { latitude: 26.1, longitude: 50.6, displayName: 'Bahrain' },
  'af-south-1':     { latitude: -33.9, longitude: 18.4, displayName: 'Cape Town' },

  // Azure
  'eastus':         { latitude: 37.4, longitude: -79.4, displayName: 'East US' },
  'eastus2':        { latitude: 36.7, longitude: -78.9, displayName: 'East US 2' },
  'westus':         { latitude: 37.8, longitude: -122.4, displayName: 'West US' },
  'westus2':        { latitude: 47.6, longitude: -122.3, displayName: 'West US 2' },
  'westus3':        { latitude: 33.4, longitude: -112.1, displayName: 'West US 3' },
  'centralus':      { latitude: 41.9, longitude: -93.6, displayName: 'Central US' },
  'northeurope':    { latitude: 53.3, longitude: -6.3, displayName: 'North Europe' },
  'westeurope':     { latitude: 52.4, longitude: 4.9, displayName: 'West Europe' },
  'uksouth':        { latitude: 51.5, longitude: -0.1, displayName: 'UK South' },
  'southeastasia':  { latitude: 1.3, longitude: 103.8, displayName: 'Southeast Asia' },
  'eastasia':       { latitude: 22.3, longitude: 114.2, displayName: 'East Asia' },
  'japaneast':      { latitude: 35.7, longitude: 139.8, displayName: 'Japan East' },
  'australiaeast':  { latitude: -33.9, longitude: 151.2, displayName: 'Australia East' },
  'brazilsouth':    { latitude: -23.6, longitude: -46.6, displayName: 'Brazil South' },

  // GCP
  'us-central1':    { latitude: 41.3, longitude: -95.9, displayName: 'Iowa' },
  'us-east1':       { latitude: 33.2, longitude: -80.0, displayName: 'S. Carolina' },
  'us-east4':       { latitude: 39.0, longitude: -77.5, displayName: 'N. Virginia' },
  'us-west1':       { latitude: 45.6, longitude: -122.6, displayName: 'Oregon' },
  'us-west4':       { latitude: 36.2, longitude: -115.2, displayName: 'Las Vegas' },
  'europe-west1':   { latitude: 50.4, longitude: 3.8, displayName: 'Belgium' },
  'europe-west2':   { latitude: 51.5, longitude: -0.1, displayName: 'London' },
  'europe-west3':   { latitude: 50.1, longitude: 8.7, displayName: 'Frankfurt' },
  'europe-west4':   { latitude: 53.4, longitude: 6.8, displayName: 'Netherlands' },
  'asia-east1':     { latitude: 24.0, longitude: 121.0, displayName: 'Taiwan' },
  'asia-southeast1': { latitude: 1.3, longitude: 103.8, displayName: 'Singapore' },
  'asia-northeast1': { latitude: 35.7, longitude: 139.7, displayName: 'Tokyo' },
  'australia-southeast1': { latitude: -33.9, longitude: 151.2, displayName: 'Sydney' },

  // IBM Cloud
  'dal':            { latitude: 32.8, longitude: -96.8, displayName: 'Dallas' },
  'wdc':            { latitude: 38.9, longitude: -77.0, displayName: 'Washington DC' },
  'lon':            { latitude: 51.5, longitude: -0.1, displayName: 'London' },
  'fra':            { latitude: 50.1, longitude: 8.7, displayName: 'Frankfurt' },
  'tok':            { latitude: 35.7, longitude: 139.7, displayName: 'Tokyo' },
  'syd':            { latitude: -33.9, longitude: 151.2, displayName: 'Sydney' },

  // On-prem / generic
  'on-prem':        { latitude: 40.7, longitude: -74.0, displayName: 'On-Premises' },
};

/**
 * Resolve a region string to geographic coordinates.
 * Tries exact match, then lowercase, then prefix match.
 */
export function resolveRegionCoords(region: string): RegionCoord | null {
  const lower = region.toLowerCase().replace(/\s+/g, '');
  if (REGION_COORDS[lower]) return REGION_COORDS[lower];

  // Try prefix match (e.g. "us-east-1a" → "us-east-1")
  for (const [key, value] of Object.entries(REGION_COORDS)) {
    if (lower.startsWith(key)) return value;
  }

  return null;
}
