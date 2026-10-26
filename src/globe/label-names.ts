// Map names: the short form an atlas prints on the land, keyed by permanent country id.
// The index carries Natural Earth's long names ("Russian Federation"), which read well in
// panels and search but rarely fit on the globe. These follow Natural Earth's own short NAME
// field. Accessible labels keep the full name.
const MAP_NAMES: Readonly<Record<string, string>> = {
  ATF: 'Fr. S. Antarctic Lands',
  ATG: 'Antigua and Barb.',
  BIH: 'Bosnia and Herz.',
  BRN: 'Brunei',
  CAF: 'Central African Rep.',
  COD: 'Dem. Rep. Congo',
  COG: 'Congo',
  CPV: 'Cabo Verde',
  CYN: 'N. Cyprus',
  DOM: 'Dominican Rep.',
  FLK: 'Falkland Is.',
  FSM: 'Micronesia',
  GNQ: 'Eq. Guinea',
  HMD: 'Heard I. and McDonald Is.',
  IOT: 'Br. Indian Ocean Ter.',
  KNA: 'St. Kitts and Nevis',
  KOR: 'South Korea',
  LAO: 'Laos',
  MHL: 'Marshall Is.',
  MNP: 'N. Mariana Is.',
  PCN: 'Pitcairn Is.',
  PRK: 'North Korea',
  PYF: 'Fr. Polynesia',
  RUS: 'Russia',
  SGS: 'S. Geo. and the Is.',
  SLB: 'Solomon Is.',
  SPM: 'St. Pierre and Miquelon',
  SWZ: 'Eswatini',
  TCA: 'Turks and Caicos Is.',
  UMI: 'U.S. Minor Outlying Is.',
  VCT: 'St. Vin. and Gren.',
  VGB: 'British Virgin Is.',
  VIR: 'U.S. Virgin Is.',
  WLF: 'Wallis and Futuna Is.',
};

export function mapLabelName(country: { id: string; name: string }) {
  return MAP_NAMES[country.id] ?? country.name;
}

// The name on two lines, broken at the space that keeps the longer line shortest.
// Single-word names stay whole. The line break collapses to a space while the name
// renders on one line, so the same text serves both forms.
export function stackedName(name: string): string | undefined {
  let best: string | undefined;
  let longest = Infinity;
  for (let at = name.indexOf(' '); at > 0; at = name.indexOf(' ', at + 1)) {
    const length = Math.max(at, name.length - at - 1);
    if (length < longest) {
      longest = length;
      best = `${name.slice(0, at)}\n${name.slice(at + 1)}`;
    }
  }
  return best;
}
