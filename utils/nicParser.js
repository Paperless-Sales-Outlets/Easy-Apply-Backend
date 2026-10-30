// Easy-Apply-Backend/utils/nicParser.js
// Sri Lankan NIC, Name, Address, and Service Area extraction heuristics for backend OCR.

export const SRI_LANKA_TOWN_DISTRICT_MAP = {
  // Colombo
  'COLOMBO': 'Colombo',
  'COLOMBO 01': 'Colombo', 'COLOMBO 02': 'Colombo', 'COLOMBO 03': 'Colombo',
  'COLOMBO 04': 'Colombo', 'COLOMBO 05': 'Colombo', 'COLOMBO 06': 'Colombo',
  'COLOMBO 07': 'Colombo', 'COLOMBO 08': 'Colombo', 'COLOMBO 09': 'Colombo',
  'COLOMBO 10': 'Colombo', 'COLOMBO 11': 'Colombo', 'COLOMBO 12': 'Colombo',
  'COLOMBO 13': 'Colombo', 'COLOMBO 14': 'Colombo', 'COLOMBO 15': 'Colombo',
  'DEHIWALA': 'Colombo', 'MOUNT LAVINIA': 'Colombo', 'MORATUWA': 'Colombo',
  'KOTTE': 'Colombo', 'BATTARAMULLA': 'Colombo', 'MAHARAGAMA': 'Colombo',
  'KOTTAWA': 'Colombo', 'PILIYANDALA': 'Colombo', 'HOMAGAMA': 'Colombo',
  'AVISSAWELLA': 'Colombo', 'NUGEGODA': 'Colombo', 'RAJAGIRIYA': 'Colombo',
  'MALABE': 'Colombo', 'PADUKKA': 'Colombo', 'PANNIPITIYA': 'Colombo',

  // Gampaha
  'GAMPAHA': 'Gampaha', 'NEGOMBO': 'Gampaha', 'KELANIYA': 'Gampaha',
  'KADAWATHA': 'Gampaha', 'RAGAMA': 'Gampaha', 'JA-ELA': 'Gampaha',
  'WATTALA': 'Gampaha', 'KIRIBATHGODA': 'Gampaha', 'MINUWANGODA': 'Gampaha',
  'MIRIGAMA': 'Gampaha', 'VEYANGODA': 'Gampaha', 'DIVULAPITIYA': 'Gampaha',
  'KANDANA': 'Gampaha',

  // Kandy
  'KANDY': 'Kandy', 'PERADENIYA': 'Kandy', 'GAMPOLA': 'Kandy',
  'KATUGASTOTA': 'Kandy', 'KUNDASALE': 'Kandy', 'NAWALAPITIYA': 'Kandy',
  'AKURANA': 'Kandy', 'TELDENIYA': 'Kandy', 'WATTEGAMA': 'Kandy', 'DIGANA': 'Kandy',

  // Nuwara Eliya
  'DICKOYA': 'Nuwara Eliya', 'HATTON': 'Nuwara Eliya', 'TALAWAKELE': 'Nuwara Eliya',
  'NUWARA ELIYA': 'Nuwara Eliya', 'MASKELIYA': 'Nuwara Eliya', 'GINIGATHHENA': 'Nuwara Eliya',
  'RAGALA': 'Nuwara Eliya', 'WALAPANE': 'Nuwara Eliya', 'KOTMALE': 'Nuwara Eliya',

  // Galle
  'GALLE': 'Galle', 'HIKKADUWA': 'Galle', 'KARAPITIYA': 'Galle',
  'ELPITIYA': 'Galle', 'AMBALANGODA': 'Galle', 'BENTOTA': 'Galle',
  'BADDEGAMA': 'Galle', 'AHANGAMA': 'Galle',

  // Matara
  'MATARA': 'Matara', 'WELIGAMA': 'Matara', 'AKURESSA': 'Matara',
  'DIKWELLE': 'Matara', 'DENIYAYA': 'Matara', 'KAMBURUPITIYA': 'Matara',

  // Jaffna
  'JAFFNA': 'Jaffna', 'CHAVAKACHCHERI': 'Jaffna', 'POINT PEDRO': 'Jaffna',
  'VALVETTITHURAI': 'Jaffna', 'NALLUR': 'Jaffna', 'KOPAY': 'Jaffna',

  // Kurunegala
  'KURUNEGALA': 'Kurunegala', 'KULIYAPITIYA': 'Kurunegala', 'IBBAGAMUWA': 'Kurunegala',
  'NARAMMALA': 'Kurunegala', 'PANNALA': 'Kurunegala', 'WARIYAPOLA': 'Kurunegala',

  // Ratnapura
  'RATNAPURA': 'Ratnapura', 'EMBILIPITIYA': 'Ratnapura', 'BALANGODA': 'Ratnapura',
  'PELMADULLA': 'Ratnapura', 'EHELIYAGODA': 'Ratnapura',

  // Kegalle
  'KEGALLE': 'Kegalle', 'MAWANELLA': 'Kegalle', 'WARAKAPOLA': 'Kegalle',
  'RUWANWELLA': 'Kegalle',

  // Badulla
  'BADULLA': 'Badulla', 'BANDARAWELA': 'Badulla', 'HAPUTALE': 'Badulla',
  'ELLA': 'Badulla', 'WELIMADA': 'Badulla', 'MAHIYANGANAYA': 'Badulla',

  // Kalutara
  'KALUTARA': 'Kalutara', 'PANADURA': 'Kalutara', 'HORANA': 'Kalutara',
  'BERUWALA': 'Kalutara', 'ALUTHGAMA': 'Kalutara', 'MATUGAMA': 'Kalutara',
  'WADDUWA': 'Kalutara', 'BANDARAGAMA': 'Kalutara',

  // Puttalam
  'PUTTALAM': 'Puttalam', 'CHILAW': 'Puttalam', 'MARAWILA': 'Puttalam',
  'WENNAPPUWA': 'Puttalam',

  // Anuradhapura
  'ANURADHAPURA': 'Anuradhapura', 'MEDAWACHCHIYA': 'Anuradhapura', 'KEKIRAWA': 'Anuradhapura',

  // Matale
  'MATALE': 'Matale', 'DAMBULLA': 'Matale', 'SIGIRIYA': 'Matale',

  // Hambantota
  'HAMBANTOTA': 'Hambantota', 'TANGALLE': 'Hambantota', 'BELIATTA': 'Hambantota',
  'AMBALANTOTA': 'Hambantota', 'TISSAMAHARAMA': 'Hambantota',

  // Trincomalee & Eastern
  'TRINCOMALEE': 'Trincomalee', 'KINNIYA': 'Trincomalee',
  'BATTICALOA': 'Batticaloa', 'KATTANKUDY': 'Batticaloa',
  'AMPARA': 'Ampara', 'KALMUNAI': 'Ampara', 'AKKARAIPATTU': 'Ampara',
  'MONARAGALA': 'Monaragala', 'WELLAWAYA': 'Monaragala',
  'POLONNARUWA': 'Polonnaruwa', 'VAVUNIYA': 'Vavuniya', 'MANNAR': 'Mannar',
  'MULLAITIVU': 'Mullaitivu', 'KILINOCHCHI': 'Kilinochchi'
};

export const SINHALA_TAMIL_TOWN_MAP = {
  'කොළඹ': 'Colombo', 'මහනුවර': 'Kandy', 'ගාල්ල': 'Galle', 'මාතර': 'Matara',
  'යාපනය': 'Jaffna', 'කුරුණෑගල': 'Kurunegala', 'ගම්පහ': 'Gampaha', 'දික්ඔය': 'Dickoya',
  'හැටන්': 'Hatton', 'නුවරඑළිය': 'Nuwara Eliya', 'බදුල්ල': 'Badulla', 'රත්නපුර': 'Ratnapura',
  'කෑගල්ල': 'Kegalle', 'කළුතර': 'Kalutara',
  'கொழும்பு': 'Colombo', 'கண்டி': 'Kandy', 'யாழ்ப்பாணம்': 'Jaffna', 'டிக்கோயா': 'Dickoya', 'ஹற்றன்': 'Hatton'
};

export function cleanNIC(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\s\-_/.]/g, '').trim().toUpperCase();
}

const OCR_DIGIT_REPAIRS = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1', '|': '1', '!': '1',
  Z: '2', E: '3', A: '4', S: '5', G: '6', T: '7', B: '8',
};

function repairOcrDigits(token) {
  return token.replace(/[OQDILZEASGTB|!]/g, (ch) => OCR_DIGIT_REPAIRS[ch] ?? ch);
}

export function extractNICFromText(text, options = {}) {
  if (!text || typeof text !== 'string') return null;
  const upper = text.toUpperCase();

  const cleanExpected = options.expectedNIC && typeof options.expectedNIC === 'string'
    ? cleanNIC(options.expectedNIC)
    : null;

  const strict = upper.match(/\b\d{9}\s?[VX]\b|\b\d{4}\s?\d{3,4}\s?\d{4,5}\b|\b\d{12}\b|\b\d{9}[VX]\b/g) || [];
  const loose = upper.match(/[0-9OQDILZEASGTB|!]{9,15}[VX]?/g) || [];

  // Match expectedNIC first if available
  if (cleanExpected) {
    for (const rawCand of [...strict, ...loose]) {
      const cleanCand = cleanNIC(repairOcrDigits(rawCand));
      if (cleanCand && cleanCand.length === cleanExpected.length) {
        let diffs = 0;
        for (let i = 0; i < cleanCand.length; i++) {
          if (cleanCand[i] !== cleanExpected[i]) diffs++;
        }
        if (diffs <= 2) {
          return { nic: cleanExpected, confidence: 0.98, matchedExpected: true };
        }
      }
    }
  }

  // Strict pass
  for (const cand of strict) {
    const cleanCand = cleanNIC(cand);
    if (/^\d{12}$/.test(cleanCand) || /^\d{9}[VX]$/.test(cleanCand)) {
      return { nic: cleanCand, confidence: 0.95 };
    }
  }

  // Loose pass with character repair
  for (const cand of loose) {
    const cleanCand = cleanNIC(repairOcrDigits(cand));
    if (/^\d{12}$/.test(cleanCand) || /^\d{9}[VX]$/.test(cleanCand)) {
      return { nic: cleanCand, confidence: 0.85, repaired: true };
    }
  }

  return null;
}

export function deriveGenderAndDOBFromNIC(nicInput) {
  if (!nicInput) return null;
  const cleaned = cleanNIC(nicInput);

  let year = null;
  let rawDayOfYear = null;

  if (/^\d{12}$/.test(cleaned)) {
    year = parseInt(cleaned.slice(0, 4), 10);
    rawDayOfYear = parseInt(cleaned.slice(4, 7), 10);
  } else if (/^\d{9}[VX]?$/i.test(cleaned)) {
    const twoDigit = parseInt(cleaned.slice(0, 2), 10);
    year = twoDigit === 0 ? 2000 : 1900 + twoDigit;
    rawDayOfYear = parseInt(cleaned.slice(2, 5), 10);
  }

  if (rawDayOfYear !== null && !isNaN(rawDayOfYear)) {
    const isMale = rawDayOfYear < 500;
    const gender = isMale ? 'Male' : 'Female';
    const dayOfYear = isMale ? rawDayOfYear : rawDayOfYear - 500;

    let dob = null;
    if (year && dayOfYear >= 1 && dayOfYear <= 366) {
      const monthRanges = [
        { m: 1, d: 31 }, { m: 2, d: 29 }, { m: 3, d: 31 },
        { m: 4, d: 30 }, { m: 5, d: 31 }, { m: 6, d: 30 },
        { m: 7, d: 31 }, { m: 8, d: 31 }, { m: 9, d: 30 },
        { m: 10, d: 31 }, { m: 11, d: 30 }, { m: 12, d: 31 }
      ];
      let rem = dayOfYear;
      let month = 1;
      let day = 1;
      for (const r of monthRanges) {
        if (rem <= r.d) {
          month = r.m;
          day = rem;
          break;
        }
        rem -= r.d;
      }
      dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return { gender, dob, year, dayOfYear };
  }
  return null;
}

export function repairOcrName(name) {
  if (!name || typeof name !== 'string') return '';
  let repaired = name;
  repaired = repaired.replace(/\b([A-Za-z]*?)NALINGAM\b/gi, '$1HALINGAM');
  repaired = repaired.replace(/\bDAWANHAF\b/gi, 'DAWANHAREN');
  repaired = repaired.replace(/\bDAWANHAR\b/gi, 'DAWANHAREN');
  repaired = repaired.replace(/\b([A-Za-z]{3,})HAF\b/gi, '$1HAREN');
  repaired = repaired.replace(/\bVV/g, 'W');
  return repaired;
}

export function extractFullNameFromOCR(text) {
  if (!text || typeof text !== 'string') return '';

  const ignoredKeywords = [
    'DEMOCRATIC', 'SOCIALIST', 'REPUBLIC', 'SRI', 'LANKA', 'SRILANKA',
    'NATIONAL', 'IDENTITY', 'CARD', 'DEPARTMENT', 'REGISTRATION',
    'PERSONS', 'DATE', 'BIRTH', 'GENDER', 'SEX', 'MALE', 'FEMALE',
    'HOLDER', 'SIGNATURE', 'PLACE', 'COUNTRY', 'LANKAN', 'SRILANKAN',
    'MINISTRY', 'DEFENCE', 'OFFICIAL', 'SECRETARY',
    'UCT', 'UTC', 'ICT', 'TC', 'NIC', 'SLT', 'NATIONALITY',
    'ROAD', 'STREET', 'MAWATHA', 'AVENUE', 'LANE', 'TEMPLE', 'GARDENS', 'ESTATE'
  ];

  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanNameToken = (cand) => {
    let cleaned = cand
      .replace(/^(?:UCT|UTC|ICT|TC|NIC|IC|E\s*IC|NO|ID|DOC|SRI\s*LANKAN|LANKAN)\s+/i, '')
      .replace(/\s+(?:UCT|UTC|ICT|TC|NIC|IC|NO|ID)$/i, '')
      .replace(/^[,\s.-]+/, '')
      .replace(/[,\s.-]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return repairOcrName(cleaned);
  };

  let bestCandidate = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Label based match (e.g. "Name: PERERA" or "Name: KAMAL PERERA")
    const nameMatch = rawLine.match(/(?:Name|Full\s*Name|Names)[\s:\-/]+([A-Za-z\s.-]{3,})/i);
    if (nameMatch && nameMatch[1]) {
      const candidate = cleanNameToken(nameMatch[1].replace(/[^A-Za-z\s.-]/g, '').trim().toUpperCase());
      const words = candidate.split(/\s+/).filter((w) => w.length > 1);
      const isIgnored = words.some((w) => ignoredKeywords.includes(w.toUpperCase()));
      if (!isIgnored && candidate.length > bestCandidate.length) {
        bestCandidate = candidate;
        continue;
      }
    }

    // Header on one line, actual name on following line
    if (/(?:Name|Full\s*Name|Names)\b/i.test(rawLine) && lines[i + 1]) {
      const nextCandidate = cleanNameToken(lines[i + 1].replace(/[^A-Za-z\s.-]/g, '').trim().toUpperCase());
      const words = nextCandidate.split(/\s+/).filter((w) => w.length > 1);
      const isIgnored = words.some((w) => ignoredKeywords.includes(w.toUpperCase()));
      if (!isIgnored && nextCandidate.length > 3 && nextCandidate.length > bestCandidate.length) {
        bestCandidate = nextCandidate;
        continue;
      }
    }

    // Direct match for uppercase name words (2 to 5 words)
    const matchUpperWords = rawLine.match(/\b([A-Z]{2,}(?:\s+[A-Z]{2,}){1,4})\b/);
    if (matchUpperWords && matchUpperWords[1]) {
      const candidate = cleanNameToken(matchUpperWords[1]);
      const words = candidate.split(/\s+/);
      const isIgnored = words.some((w) => ignoredKeywords.includes(w.toUpperCase()));
      if (!isIgnored && candidate.length > bestCandidate.length) {
        bestCandidate = candidate;
        continue;
      }
    }

    // Names with initials
    const matchInitials = rawLine.match(/\b((?:[A-Z]\.?\s*){1,3}[A-Z]{3,}(?:\s+[A-Z]{3,})?)\b/);
    if (matchInitials && matchInitials[1]) {
      const candidate = cleanNameToken(matchInitials[1]);
      const words = candidate.split(/\s+/);
      const isIgnored = words.some((w) => ignoredKeywords.includes(w.toUpperCase()));
      if (!isIgnored && candidate.length > bestCandidate.length) {
        bestCandidate = candidate;
      }
    }
  }

  return cleanNameToken(bestCandidate);
}

export function extractAddressFromOCR(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const ignoredAdministrativeKeywords = [
    'REGISTRATION OF PERSONS', 'COMMISSIONER GENERAL', 'PLACE OF BIRTH',
    'DATE OF ISSUE', 'DEPARTMENT', 'REPUBLIC OF SRI LANKA', 'HOLDER',
    'SIGNATURE', 'MINISTRY', 'SECRETARY',
    'REGISTRATION', 'PERSONS ACT', '32 OF 1968', 'NO. 32',
    'පුද්ගලයින් ලියාපදිංචි', 'පාලක ජනරාල්', 'උපන් ස්ථානය', 'නිකුත් කළ දිනය',
    'ශ්‍රී ලංකා', 'අත්සන', 'පනත'
  ];

  const addressKeywords = [
    'ROAD', 'STREET', 'MAWATHA', 'DIVISION', 'LANE', 'AVENUE', 'ESTATE',
    'GARDENS', 'WATTE', 'TOWN', 'NAGAR', 'THOTTAM', 'GAMAYA', 'VILLAGE',
    'SCHEME', 'HOUSING', 'NO.', 'NO',
    ...Object.keys(SRI_LANKA_TOWN_DISTRICT_MAP)
  ];

  const candidateLines = [];

  for (const rawLine of lines) {
    const upper = rawLine.toUpperCase();
    if (ignoredAdministrativeKeywords.some((kw) => upper.includes(kw))) continue;
    if (/(?:Registration|Persons|Act|Noo?\s*32|1968|Commissioner|Birth|Issue)/i.test(rawLine) &&
        /(?:32|1968|Act|Persons)/i.test(rawLine)) continue;
    if (/^\d{4}[/.-]\d{2}[/.-]\d{2}/.test(rawLine.trim())) continue;

    const hasAddressKw = addressKeywords.some((kw) => upper.includes(kw));
    const isHouseNumberLine = /^(?:No\.?|#)?\s*\d+[/\-A-Za-z0-9]*,?\s+[A-Za-z]{3,}/i.test(rawLine);

    if (hasAddressKw || isHouseNumberLine) {
      let clean = rawLine
        .replace(/(?:FETC|SETEC|DRP)\b.*$/i, '')
        .replace(/(?:Registration|Persons|Act|Noo?\s*32|1968)\b.*$/i, '')
        .replace(/^[^\dA-Za-z]+/, '')
        .replace(/[£§©®™|\\_~@#^*=[\]{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (clean.length >= 3) {
        candidateLines.push(clean);
      }
    }
  }

  // Prioritize English lines
  const englishLines = candidateLines.filter((l) => /[A-Za-z]{3,}/.test(l));
  const selectedLines = englishLines.length > 0 ? englishLines : candidateLines;

  if (selectedLines.length > 0) {
    return selectedLines.join(', ')
      .replace(/,\s*,/g, ', ')
      .replace(/\s+,/g, ', ')
      .trim();
  }

  return '';
}

export function deriveServiceAreaFromAddress(addressStr) {
  if (!addressStr || typeof addressStr !== 'string') return null;
  const upper = addressStr.toUpperCase();
  for (const [town, district] of Object.entries(SRI_LANKA_TOWN_DISTRICT_MAP)) {
    if (upper.includes(town)) {
      return {
        town,
        district,
        city: town.charAt(0) + town.slice(1).toLowerCase(),
      };
    }
  }
  return null;
}
