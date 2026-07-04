// Country name -> ISO code mapping for flag images (flagcdn.com serves
// every flag by code, including gb-eng style sub-nations). Names match the
// TxLINE feed's spellings; unknown teams fall back to a ball glyph.

const CODES: Record<string, string> = {
  // Hosts + the usual suspects
  usa: "us", "united states": "us", canada: "ca", mexico: "mx",
  argentina: "ar", brazil: "br", uruguay: "uy", chile: "cl", colombia: "co",
  peru: "pe", ecuador: "ec", paraguay: "py", bolivia: "bo", venezuela: "ve",
  england: "gb-eng", scotland: "gb-sct", wales: "gb-wls",
  "northern ireland": "gb-nir", ireland: "ie", "republic of ireland": "ie",
  france: "fr", germany: "de", spain: "es", portugal: "pt", italy: "it",
  netherlands: "nl", belgium: "be", croatia: "hr", switzerland: "ch",
  austria: "at", denmark: "dk", sweden: "se", norway: "no", poland: "pl",
  "czech republic": "cz", czechia: "cz", serbia: "rs", ukraine: "ua",
  turkey: "tr", "türkiye": "tr", greece: "gr", hungary: "hu", romania: "ro",
  slovakia: "sk", slovenia: "si", albania: "al", georgia: "ge",
  "bosnia & herzegovina": "ba", "bosnia and herzegovina": "ba",
  "north macedonia": "mk", montenegro: "me", finland: "fi", iceland: "is",
  russia: "ru", scotland2: "gb-sct",
  // Africa
  morocco: "ma", senegal: "sn", tunisia: "tn", algeria: "dz", egypt: "eg",
  nigeria: "ng", ghana: "gh", cameroon: "cm", "ivory coast": "ci",
  "cote d'ivoire": "ci", mali: "ml", "burkina faso": "bf",
  "south africa": "za", "dr congo": "cd", "congo dr": "cd", congo: "cg",
  "cape verde": "cv", "cabo verde": "cv", zambia: "zm", kenya: "ke",
  uganda: "ug", tanzania: "tz", ethiopia: "et", gabon: "ga", guinea: "gn",
  angola: "ao", mozambique: "mz", benin: "bj", togo: "tg", niger: "ne",
  "equatorial guinea": "gq", madagascar: "mg", zimbabwe: "zw",
  // Asia + Oceania
  japan: "jp", "south korea": "kr", "korea republic": "kr", australia: "au",
  "saudi arabia": "sa", iran: "ir", qatar: "qa", iraq: "iq", uzbekistan: "uz",
  jordan: "jo", uae: "ae", "united arab emirates": "ae", china: "cn",
  "china pr": "cn", vietnam: "vn", thailand: "th", indonesia: "id",
  malaysia: "my", myanmar: "mm", india: "in", "new zealand": "nz",
  oman: "om", bahrain: "bh", kuwait: "kw", lebanon: "lb", syria: "sy",
  palestine: "ps", "north korea": "kp", "korea dpr": "kp",
  philippines: "ph", singapore: "sg", "hong kong": "hk",
  // CONCACAF + others
  "costa rica": "cr", panama: "pa", honduras: "hn", jamaica: "jm",
  "el salvador": "sv", guatemala: "gt", haiti: "ht", cuba: "cu",
  "trinidad & tobago": "tt", "trinidad and tobago": "tt", curacao: "cw",
  "curaçao": "cw", suriname: "sr",
};

/** ISO code for a team name, or null when unknown (club sides, mocks). */
export function flagCode(teamName: string): string | null {
  return CODES[teamName.trim().toLowerCase()] ?? null;
}

/** Flag image URL, proxied through our own /api/flag route (cached hard). */
export function flagUrl(code: string, retina = false): string {
  return `/api/flag/${code}${retina ? "?2x" : ""}`;
}
