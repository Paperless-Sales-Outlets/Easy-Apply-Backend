/**
 * OSS (Operations Support System) Service Feasibility & Network Qualification
 * Simulates SLTMobitel OSS loop checks, Fibre FDP port qualification,
 * and 4G/LTE mobile broadband radio coverage verification.
 */

// Known SLTMobitel Regional Exchanges in Sri Lanka
const REGIONAL_EXCHANGES = [
  { prefix: 'CMB', name: 'Colombo Central Exchange', city: 'Colombo', lat: 6.9271, lng: 79.8612 },
  { prefix: 'HAV', name: 'Havelock Town Exchange', city: 'Colombo 05', lat: 6.8833, lng: 79.8653 },
  { prefix: 'KND', name: 'Kandy Main Exchange', city: 'Kandy', lat: 7.2906, lng: 80.6337 },
  { prefix: 'GMP', name: 'Gampaha Regional Exchange', city: 'Gampaha', lat: 7.0840, lng: 79.9939 },
  { prefix: 'GAL', name: 'Galle Fort Exchange', city: 'Galle', lat: 6.0535, lng: 80.2210 },
  { prefix: 'NEG', name: 'Negombo Coastal Exchange', city: 'Negombo', lat: 7.2088, lng: 79.8358 },
  { prefix: 'KRN', name: 'Kurunegala Exchange', city: 'Kurunegala', lat: 7.4863, lng: 80.3623 },
  { prefix: 'JAF', name: 'Jaffna City Exchange', city: 'Jaffna', lat: 9.6615, lng: 80.0255 },
  { prefix: 'MAT', name: 'Matara Southern Exchange', city: 'Matara', lat: 5.9549, lng: 80.5550 },
  { prefix: 'ANU', name: 'Anuradhapura Heritage Exchange', city: 'Anuradhapura', lat: 8.3114, lng: 80.4037 },
  { prefix: 'BAD', name: 'Badulla Central Exchange', city: 'Badulla', lat: 6.9934, lng: 81.0550 },
  { prefix: 'RAT', name: 'Ratnapura Exchange', city: 'Ratnapura', lat: 6.6828, lng: 80.4034 },
];

// Curated Alternative Products
export const ALTERNATIVE_PRODUCTS = {
  LTE: [
    {
      _id: 'prod-4',
      productId: 'prod-4',
      name: 'LTE Home 150 GB',
      productName: 'LTE Home 150 GB',
      category: 'LTE Home',
      serviceType: 'Broadband',
      speed: 'Up to 100 Mbps',
      monthlyPrice: 3999,
      installationFee: 2500,
      quota: '150 GB Anytime Data',
      features: [
        'Instant Plug & Play 4G WiFi Router',
        'No Optical Cable Wiring Required',
        'Same-Day / Next-Day Courier Delivery',
        'Mobitel Super 4G LTE-Advanced Coverage'
      ],
      description: 'Ultra-fast home wireless broadband powered by Mobitel LTE network. Ideal immediate replacement when Fibre is pending.',
      isAlternative: true,
      alternativeReason: 'Immediate wireless broadband with excellent LTE signal at your location',
    },
    {
      _id: 'prod-5',
      productId: 'prod-5',
      name: 'LTE Home 300 GB',
      productName: 'LTE Home 300 GB',
      category: 'LTE Home',
      serviceType: 'Broadband',
      speed: 'Up to 100 Mbps',
      monthlyPrice: 4999,
      installationFee: 2500,
      quota: '300 GB Anytime Data',
      features: [
        'High-Capacity Wireless Broadband',
        'Multi-Device HD Streaming & Gaming',
        'Plug & Play 4G WiFi Router Included',
        'No Structural Drilling or Wall Cabling'
      ],
      description: 'High-bandwidth 4G LTE wireless package for heavy domestic or small office usage.',
      isAlternative: true,
      alternativeReason: 'High-quota wireless alternative for heavy data consumption',
    },
  ],
  FIBRE: [
    {
      _id: 'prod-1',
      productId: 'prod-1',
      name: 'Fibre Unlimited 100M',
      productName: 'Fibre Unlimited 100M',
      category: 'Fibre Broadband',
      serviceType: 'Broadband',
      speed: '100 Mbps',
      monthlyPrice: 6999,
      installationFee: 0,
      quota: 'Unlimited',
      features: [
        'Pure Optical Fibre to the Home (FTTH)',
        'Low-Latency Optical Line Terminal (OLT)',
        'Unlimited High-Speed Optical Internet',
        'Free Wi-Fi 6 Optical Router'
      ],
      description: 'Lightning-fast pure Fibre optical connection directly to your premises.',
      isAlternative: true,
      alternativeReason: 'Ultra-fast Gigabit optical fibre connection available at your address',
    },
    {
      _id: 'prod-2',
      productId: 'prod-2',
      name: 'Fibre Flash 300M',
      productName: 'Fibre Flash 300M',
      category: 'Fibre Broadband',
      serviceType: 'Broadband',
      speed: '300 Mbps',
      monthlyPrice: 8999,
      installationFee: 0,
      quota: 'Unlimited',
      features: [
        'Blazing 300 Mbps Optical Bandwidth',
        'Ultra-low Ping (under 5ms)',
        'Ideal for 4K/8K and Cloud Gaming',
        'Free Dual-Band Wi-Fi 6 ONT Router'
      ],
      description: 'Supercharged 300 Mbps optical connection for maximum digital performance.',
      isAlternative: true,
      alternativeReason: 'Top-tier optical speed available via nearby FDP',
    },
  ],
};

/**
 * Calculates straight line distance between two coordinates in meters
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Main OSS Feasibility Qualification engine
 */
export function checkOSSFeasibility({
  address = '',
  city = '',
  district = '',
  latitude = null,
  longitude = null,
  requestedProduct = null,
} = {}) {
  const addressText = `${address || ''} ${city || ''} ${district || ''}`.trim().toLowerCase();

  // Demo Mode: Only Colombo areas have Fibre loop coverage available.
  // Other areas outside Colombo are unavailable for loops.
  const COLOMBO_KEYWORDS = [
    'colombo',
    'dehiwala',
    'mount lavinia',
    'nugegoda',
    'maharagama',
    'kottawa',
    'battaramulla',
    'kotte',
    'malabe',
    'rajagiriya',
    'moratuwa',
    'piliyandala',
    'homagama',
    'padukka',
    'hanwella',
    'hokandara',
    'thalawathugoda',
    'pannipitiya',
    'havelock',
    'wellawatte',
    'bambalapitiya',
    'kollupitiya',
    'fort',
    'borella',
    'maradana',
    'pettah',
    'cinnamon gardens',
    'kotahena',
    'grandpass',
    'modara',
    'dematagoda',
    'hulftsdorp',
    'slave island',
  ];

  const isColomboArea =
    (district && district.toLowerCase().includes('colombo')) ||
    COLOMBO_KEYWORDS.some((kw) => addressText.includes(kw));

  // Test simulation keywords
  const isSimulatedNoFibre =
    !isColomboArea ||
    addressText.includes('no fibre') ||
    addressText.includes('no-fibre') ||
    addressText.includes('ports full') ||
    addressText.includes('fdp full') ||
    addressText.includes('no fdp');

  const isSimulatedNoCoverage =
    addressText.includes('no loop') ||
    addressText.includes('no-loop') ||
    addressText.includes('unavailable') ||
    addressText.includes('remote zone') ||
    addressText.includes('dead zone');

  // Resolved Coordinates: default to Colombo Central if unassigned
  const resolvedLat = Number(latitude) || 6.9271;
  const resolvedLng = Number(longitude) || 79.8612;

  // Find nearest serving exchange
  let nearestExchange = REGIONAL_EXCHANGES[0];
  let minDistance = Infinity;

  REGIONAL_EXCHANGES.forEach((ex) => {
    const dist = getDistanceMeters(resolvedLat, resolvedLng, ex.lat, ex.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestExchange = ex;
    }
  });

  // Seed pseudo-random reproducible figures based on coordinates/text
  const hashSeed = Math.abs(
    Math.sin(resolvedLat * 12.9898 + resolvedLng * 78.233) * 43758.5453
  );
  const hashVal = hashSeed - Math.floor(hashSeed);

  // 1. FIBRE FDP (Fibre Distribution Point) QUALIFICATION
  // Max drop cable limit in SLTMobitel is 350 meters
  let fdpDistanceMeters = Math.floor(45 + hashVal * 210); // Typically 45m - 255m
  let fdpAvailablePorts = Math.floor(2 + (hashVal * 10) % 5); // Typically 2 - 6 ports
  const totalFdpPorts = 8;
  const fdpId = `FDP-${nearestExchange.prefix}-${Math.floor(1000 + hashVal * 8999)}`;

  let fibreAvailable = true;
  let fibreStatus = 'FEASIBLE';
  let fibreReason = `Direct optical drop cable path verified to ${fdpId} (${fdpDistanceMeters}m away, ${fdpAvailablePorts} of ${totalFdpPorts} ports free) in Colombo service area.`;

  if (!isColomboArea) {
    fibreAvailable = false;
    fibreStatus = 'NO_LOOP';
    fdpDistanceMeters = 1250;
    fdpAvailablePorts = 0;
    fibreReason = `In this demo version, Fibre loop coverage is available only for Colombo areas. No active Fibre loop exists for ${city || district || 'this location'}.`;
  } else if (isSimulatedNoCoverage) {
    fibreAvailable = false;
    fibreStatus = 'UNSERVICED';
    fdpDistanceMeters = 850;
    fdpAvailablePorts = 0;
    fibreReason = `Address is outside SLTMobitel optical distribution boundary. Nearest exchange is ${nearestExchange.name}.`;
  } else if (isSimulatedNoFibre) {
    fibreAvailable = false;
    fibreStatus = 'PORTS_EXHAUSTED';
    fdpAvailablePorts = 0;
    fibreReason = `All 8 optical distribution ports on local terminal (${fdpId}) are currently fully allocated. Drop expansion required.`;
  } else if (fdpDistanceMeters > 350) {
    fibreAvailable = false;
    fibreStatus = 'OUT_OF_RANGE';
    fibreReason = `Premises distance (${fdpDistanceMeters}m) exceeds the maximum 350m optical drop cable engineering threshold from ${fdpId}.`;
  }

  // 2. MOBITEL 4G / LTE COVERAGE QUALIFICATION
  const towerDistanceKm = Number((0.3 + hashVal * 1.2).toFixed(2));
  const towerId = `ENB-${nearestExchange.prefix}-${Math.floor(200 + hashVal * 700)} (${nearestExchange.city})`;
  let lteAvailable = true;
  let lteSignalStrength = 'EXCELLENT';
  let lteSignalPercent = 94;
  let lteRsrp = -78;
  let lteStatus = 'AVAILABLE';
  let lteReason = `Strong 4G LTE-Advanced carrier aggregation active from ${towerId} (${towerDistanceKm} km).`;

  if (isSimulatedNoCoverage) {
    lteAvailable = false;
    lteSignalStrength = 'NONE';
    lteSignalPercent = 12;
    lteRsrp = -118;
    lteStatus = 'NO_COVERAGE';
    lteReason = 'Signal attenuation exceeds receiver thresholds. No serving Mobitel cellular sector detected.';
  } else if (hashVal < 0.15) {
    lteSignalStrength = 'GOOD';
    lteSignalPercent = 82;
    lteRsrp = -92;
    lteReason = `Good 4G coverage detected from ${towerId}. Suitable for HD streaming and home broadband.`;
  }

  // 3. PRODUCT & REQUESTED SERVICE MATCHING
  const prodName = (requestedProduct?.productName || requestedProduct?.name || '').toLowerCase();
  const prodCat = (requestedProduct?.category || '').toLowerCase();

  const isFibreProduct =
    prodCat.includes('fibre') ||
    prodCat.includes('fiber') ||
    prodName.includes('fibre') ||
    prodName.includes('fiber') ||
    prodCat.includes('ftth') ||
    prodName.includes('ftth');

  const isLteProduct =
    prodCat.includes('lte') ||
    prodName.includes('lte') ||
    prodCat.includes('4g') ||
    prodName.includes('4g');

  let requestedServiceFeasible = true;
  let requestedServiceMessage = 'Selected service is 100% compatible with your installation location.';
  let alternativeServices = [];

  if (isFibreProduct) {
    if (!fibreAvailable) {
      requestedServiceFeasible = false;
      requestedServiceMessage = `The selected package (${requestedProduct?.productName || 'Fibre Broadband'}) is currently unavailable at this exact address because ${fibreReason}`;
      if (lteAvailable) {
        alternativeServices = ALTERNATIVE_PRODUCTS.LTE;
      }
    }
  } else if (isLteProduct) {
    if (!lteAvailable) {
      requestedServiceFeasible = false;
      requestedServiceMessage = `The selected package (${requestedProduct?.productName || 'LTE Home'}) is currently unavailable at this location due to lack of 4G coverage.`;
      if (fibreAvailable) {
        alternativeServices = ALTERNATIVE_PRODUCTS.FIBRE;
      }
    }
  } else {
    // If user has not picked a specific category yet or category is general:
    if (!fibreAvailable && lteAvailable) {
      alternativeServices = ALTERNATIVE_PRODUCTS.LTE;
    } else if (fibreAvailable && !lteAvailable) {
      alternativeServices = ALTERNATIVE_PRODUCTS.FIBRE;
    }
  }

  // Overall feasibility verdict
  let overallStatus = 'FEASIBLE';
  if (!fibreAvailable && !lteAvailable) {
    overallStatus = 'UNAVAILABLE';
  } else if (!requestedServiceFeasible || (!fibreAvailable && isFibreProduct) || (!lteAvailable && isLteProduct)) {
    overallStatus = 'PARTIALLY_FEASIBLE';
  }

  return {
    success: true,
    available: overallStatus !== 'UNAVAILABLE',
    overallStatus,
    timestamp: new Date().toISOString(),
    location: {
      address: address || 'Current Location',
      city: city || nearestExchange.city,
      district: district || nearestExchange.city,
      latitude: resolvedLat,
      longitude: resolvedLng,
      servingExchange: {
        name: nearestExchange.name,
        code: nearestExchange.prefix,
        distanceMeters: minDistance,
      },
    },
    fibre: {
      available: fibreAvailable,
      status: fibreStatus,
      fdpId,
      distanceMeters: fdpDistanceMeters,
      maxDistanceMeters: 350,
      availablePorts: fdpAvailablePorts,
      totalPorts: totalFdpPorts,
      splitterType: '1:8 PLC Optical Splitter',
      opticalPowerDbm: -19.4,
      maxSpeed: 'Up to 1 Gbps Gigabit FTTH',
      provisionDays: 3,
      reason: fibreReason,
    },
    lte: {
      available: lteAvailable,
      status: lteStatus,
      signalStrength: lteSignalStrength,
      signalPercent: lteSignalPercent,
      rsrp: lteRsrp,
      nearestTower: towerId,
      distanceKm: towerDistanceKm,
      bands: ['B3 (1800 MHz)', 'B40 (2300 MHz TD-LTE)', 'B8 (900 MHz)'],
      maxSpeed: 'Up to 100 Mbps',
      provisionDays: 1,
      reason: lteReason,
    },
    requestedProduct: requestedProduct || null,
    requestedServiceFeasible,
    requestedServiceMessage,
    alternativeServices,
  };
}
