// ISO 3166-1 alpha-2 country codes grouped by continent.
//
// Countries that straddle a boundary are filed where listeners would
// look for them: Russia and Turkey under Europe and Asia respectively,
// following the usual convention rather than geography.

const GROUPS = {
  namerica: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  samerica: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  europe:   'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  africa:   'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  asia:     'AE AF AM AZ BD BH BN BT CC CN CX GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TM TR TW UZ VN YE',
  oceania:  'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TL TO TV UM VU WF WS'
};

/**
 * Display order and colour. The dots are the only colour in an
 * otherwise monochrome interface, so they stay muted.
 */
export const CONTINENTS = [
  { id: 'namerica', label: 'N. America', color: '#e8a33d' },
  { id: 'samerica', label: 'S. America', color: '#d9694a' },
  { id: 'europe',   label: 'Europe',     color: '#5b8def' },
  { id: 'africa',   label: 'Africa',     color: '#4caf7d' },
  { id: 'asia',     label: 'Asia',       color: '#c2555b' },
  { id: 'oceania',  label: 'Oceania',    color: '#9b8ec4' }
];

const BY_COUNTRY = (() => {
  const map = new Map();
  for (const [continent, codes] of Object.entries(GROUPS)) {
    for (const code of codes.split(' ')) map.set(code, continent);
  }
  return map;
})();

const COLOR_BY_ID = new Map(CONTINENTS.map(c => [c.id, c.color]));

/**
 * Continent id for a station, or null when the country code is missing
 * or unrecognised (Antarctic territories, retired codes).
 */
export function getStationContinent(station) {
  const code = station.countrycode && station.countrycode.trim().toUpperCase();
  if (!code || code.length !== 2) return null;
  return BY_COUNTRY.get(code) || null;
}

export function getContinentColor(id) {
  return COLOR_BY_ID.get(id) || null;
}
