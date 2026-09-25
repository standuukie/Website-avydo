// Gestructureerde, handmatig geverifieerde dataset met fiscale deadlines
// voor de Belastingkalender (/belastingkalender).
//
// BELANGRIJK — hoe deze dataset tot stand is gekomen:
// Elke deadline hieronder is herleid tot een daadwerkelijk geraadpleegde,
// officiële pagina van de Belastingdienst (geen zoekmachine, geen gok-URL's,
// geen door AI verzonnen data). De exacte bron-URL en de datum waarop deze
// is gecontroleerd staan bij elke deadline (sourceUrl / lastVerified). Waar
// de bron een tabel met exacte data gaf (btw, loonheffingen) is die tabel
// letterlijk overgenomen. Waar de bron een algemene, jaarlijks terugkerende
// regel gaf in plaats van een tabel (vennootschapsbelasting, inkomsten-
// belasting, dividendbelasting), is die regel toegepast — nooit een eigen
// interpretatie van een niet-bestaande regel.
//
// Bewust NIET opgenomen (conform de opdracht "bij twijfel: niet opnemen"):
// - KVK/vergunning-achtige "deadlines": geen betrouwbare, generieke datum
//   beschikbaar (sterk situatie-afhankelijk).
// - Voorlopige aanslag aanvragen/wijzigen: dit is een doorlopende
//   mogelijkheid zonder harde uiterste datum, geen aangifte-deadline.
// - Btw-jaaropgaaf-ICP en de kwartaal-ICP-drempelregeling: de officiële
//   voorwaarden zijn conditioneel (drempelbedrag, 4 voorgaande kwartalen)
//   en lenen zich niet voor een simpele vaste-datumregel zonder het
//   drempelbedrag zelf te kennen; alleen de onvoorwaardelijke maandregel
//   voor ICP is overgenomen.
// - Loonheffingen "vierwekenaangifte"-tijdvakken: wel beschikbaar in de
//   bron, maar weggelaten om de kalender overzichtelijk te houden voor de
//   meest gebruikelijke situatie (aangifte per kalendermaand). Wie per
//   4 weken aangifte doet, wordt via de brontekst naar de brochure
//   verwezen.
// - Toekomstige jaren (bijv. volledige btw-tabel voor 2027) waarvoor de
//   Belastingdienst nog geen officiële tabel heeft gepubliceerd op het
//   moment van verifiëren.

export const taxTypes = [
  'btw',
  'loonheffingen',
  'inkomstenbelasting',
  'vennootschapsbelasting',
  'dividendbelasting',
  'icp',
] as const;
export type TaxType = (typeof taxTypes)[number];

export const taxTypeLabels: Record<TaxType, string> = {
  btw: 'Btw',
  loonheffingen: 'Loonheffingen',
  inkomstenbelasting: 'Inkomstenbelasting',
  vennootschapsbelasting: 'Vennootschapsbelasting',
  dividendbelasting: 'Dividendbelasting',
  icp: 'ICP',
};

export const businessAudiences = ['zzp', 'bv-dga', 'werkgever', 'mkb-ondernemer'] as const;
export type BusinessAudience = (typeof businessAudiences)[number];

export const businessAudienceLabels: Record<BusinessAudience, string> = {
  zzp: "ZZP'er / eenmanszaak",
  'bv-dga': 'BV / DGA',
  werkgever: 'Werkgever',
  'mkb-ondernemer': 'MKB-ondernemer',
};

export interface TaxDeadline {
  id: string;
  taxType: TaxType;
  title: string;
  /** Mensleesbare periode, bv. "Januari 2026" of "4e kwartaal 2026". */
  period: string;
  /**
   * ISO-datum (YYYY-MM-DD) van de uiterste aangifte-/betaaldatum, of null
   * voor een deadline die geen vaste kalenderdatum heeft (bv.
   * dividendbelasting: "binnen 1 maand na uitkering").
   */
  deadline: string | null;
  recurrence: 'monthly' | 'quarterly' | 'yearly' | 'event';
  audiences: BusinessAudience[];
  description: string;
  forWhom: string;
  whatToDo: string;
  sourceName: string;
  sourceUrl: string;
  lastVerified: string;
}

const MONTH_NAMES = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

function monthLabel(year: number, month1to12: number): string {
  return `${MONTH_NAMES[month1to12 - 1][0].toUpperCase()}${MONTH_NAMES[month1to12 - 1].slice(1)} ${year}`;
}

const BTW_SOURCE = {
  sourceName: 'Belastingdienst',
  sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/uiterste-aangifte-en-betaaldatums',
  lastVerified: '2026-09-25',
};

const LOONHEFFINGEN_SOURCE = {
  sourceName: 'Belastingdienst',
  sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/aangifte-loonheffingen-tijdvakcodes-aangifte-en-betaaldatums',
  lastVerified: '2026-09-25',
};

const ICP_SOURCE = {
  sourceName: 'Belastingdienst',
  sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/internationaal/btw_voor_buitenlandse_ondernemers/btw_aangifte_doen_en_betalen/aangifte_doen/opgaaf_icp/opgaaf_intracommunautaire_prestaties',
  lastVerified: '2026-09-25',
};

// Letterlijk overgenomen uit de officiële tabel op de btw-bron hierboven
// (geraadpleegd 25-9-2026): tijdvak -> uiterste aangifte- en betaaldatum.
const BTW_MONTHLY: Array<[year: number, month: number, deadline: string]> = [
  [2025, 12, '2026-01-31'],
  [2026, 1, '2026-02-28'],
  [2026, 2, '2026-03-31'],
  [2026, 3, '2026-04-30'],
  [2026, 4, '2026-05-31'],
  [2026, 5, '2026-06-30'],
  [2026, 6, '2026-07-31'],
  [2026, 7, '2026-08-31'],
  [2026, 8, '2026-09-30'],
  [2026, 9, '2026-10-31'],
  [2026, 10, '2026-11-30'],
  [2026, 11, '2026-12-31'],
  [2026, 12, '2027-01-31'],
];

const BTW_QUARTERLY: Array<[label: string, deadline: string]> = [
  ['4e kwartaal 2025', '2026-01-31'],
  ['1e kwartaal 2026', '2026-04-30'],
  ['2e kwartaal 2026', '2026-07-31'],
  ['3e kwartaal 2026', '2026-10-31'],
  ['4e kwartaal 2026', '2027-01-31'],
];

const BTW_YEARLY: Array<[year: number, deadline: string]> = [
  [2025, '2026-03-31'],
  [2026, '2027-03-31'],
];

// Letterlijk overgenomen uit de PDF "Aangifte loonheffingen: tijdvakcodes,
// aangifte- en betaaldatums 2026" (Belastingdienst, geraadpleegd
// 25-9-2026), sectie "Maandaangiften 2026".
const LOONHEFFINGEN_MONTHLY: Array<[year: number, month: number, deadline: string]> = [
  [2026, 1, '2026-02-28'],
  [2026, 2, '2026-03-31'],
  [2026, 3, '2026-04-30'],
  [2026, 4, '2026-05-31'],
  [2026, 5, '2026-06-30'],
  [2026, 6, '2026-07-31'],
  [2026, 7, '2026-08-31'],
  [2026, 8, '2026-09-30'],
  [2026, 9, '2026-10-31'],
  [2026, 10, '2026-11-30'],
  [2026, 11, '2026-12-31'],
  [2026, 12, '2027-01-31'],
];

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const btwMonthlyDeadlines: TaxDeadline[] = BTW_MONTHLY.map(([year, month, deadline]) => ({
  id: nextId('btw-maand'),
  taxType: 'btw',
  title: `Btw-aangifte en -betaling – ${monthLabel(year, month)}`,
  period: monthLabel(year, month),
  deadline,
  recurrence: 'monthly',
  audiences: ['zzp', 'bv-dga', 'mkb-ondernemer'],
  description: `Uiterste aangifte- en betaaldatum voor de btw over het tijdvak ${monthLabel(year, month)}, voor ondernemers die per maand btw-aangifte doen.`,
  forWhom: 'Ondernemers die per maand btw-aangifte doen.',
  whatToDo: 'Dien uw btw-aangifte in en betaal het verschuldigde bedrag vóór deze datum via Mijn Belastingdienst Zakelijk.',
  ...BTW_SOURCE,
}));

const btwQuarterlyDeadlines: TaxDeadline[] = BTW_QUARTERLY.map(([label, deadline]) => ({
  id: nextId('btw-kwartaal'),
  taxType: 'btw',
  title: `Btw-aangifte en -betaling – ${label}`,
  period: label.charAt(0).toUpperCase() + label.slice(1),
  deadline,
  recurrence: 'quarterly',
  audiences: ['zzp', 'bv-dga', 'mkb-ondernemer'],
  description: `Uiterste aangifte- en betaaldatum voor de btw over het ${label}, voor ondernemers die per kwartaal btw-aangifte doen (de meest gebruikelijke situatie).`,
  forWhom: 'Ondernemers die per kwartaal btw-aangifte doen.',
  whatToDo: 'Dien uw btw-aangifte in en betaal het verschuldigde bedrag vóór deze datum via Mijn Belastingdienst Zakelijk.',
  ...BTW_SOURCE,
}));

const btwYearlyDeadlines: TaxDeadline[] = BTW_YEARLY.map(([year, deadline]) => ({
  id: nextId('btw-jaar'),
  taxType: 'btw',
  title: `Btw-aangifte en -betaling – jaaraangifte ${year}`,
  period: `Jaaraangifte ${year}`,
  deadline,
  recurrence: 'yearly',
  audiences: ['zzp', 'mkb-ondernemer'],
  description: `Uiterste aangifte- en betaaldatum voor de btw-jaaraangifte over ${year}. Jaaraangifte is alleen mogelijk na toestemming van de Belastingdienst en onder voorwaarden (o.a. minder dan €1.883 btw per jaar, alleen natuurlijke personen/samenwerkingsverbanden daarvan).`,
  forWhom: 'Kleine ondernemers (eenmanszaak of samenwerkingsverband van natuurlijke personen) met toestemming voor jaaraangifte btw.',
  whatToDo: 'Dien uw btw-jaaraangifte in en betaal het verschuldigde bedrag vóór deze datum via Mijn Belastingdienst Zakelijk.',
  sourceName: 'Belastingdienst',
  sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/wijziging-aangiftetijdvak-btw',
  lastVerified: '2026-09-25',
}));

const loonheffingenMonthlyDeadlines: TaxDeadline[] = LOONHEFFINGEN_MONTHLY.map(([year, month, deadline]) => ({
  id: nextId('lh-maand'),
  taxType: 'loonheffingen',
  title: `Aangifte en betaling loonheffingen – ${monthLabel(year, month)}`,
  period: monthLabel(year, month),
  deadline,
  recurrence: 'monthly',
  audiences: ['werkgever'],
  description: `Uiterste aangifte- en betaaldatum voor de loonheffingen over het tijdvak ${monthLabel(year, month)}, voor werkgevers die per kalendermaand loonaangifte doen. Doet u aangifte per periode van 4 weken? Dan gelden andere tijdvakken en data; zie de officiële brochure.`,
  forWhom: 'Werkgevers met personeel in dienst (ook bij een nihil- of nulaangifte).',
  whatToDo: 'Dien uw aangifte loonheffingen in en betaal het verschuldigde bedrag vóór deze datum via Mijn Belastingdienst Zakelijk of uw aangiftesoftware.',
  ...LOONHEFFINGEN_SOURCE,
}));

// De opgaaf ICP volgt voor de maandelijkse variant onvoorwaardelijk dezelfde
// regel als de btw ("uiterlijk de laatste dag van de maand, volgend op een
// kalendermaand" — letterlijk zo genoemd op de ICP-bron), en daarmee ook
// dezelfde datums als de btw-maandaangifte hierboven.
const icpMonthlyDeadlines: TaxDeadline[] = BTW_MONTHLY.map(([year, month, deadline]) => ({
  id: nextId('icp-maand'),
  taxType: 'icp',
  title: `Opgaaf ICP – ${monthLabel(year, month)}`,
  period: monthLabel(year, month),
  deadline,
  recurrence: 'monthly',
  audiences: ['zzp', 'bv-dga', 'mkb-ondernemer'],
  description: `Uiterste datum voor de opgaaf intracommunautaire prestaties (ICP) over ${monthLabel(year, month)}, voor ondernemers die per maand opgaaf doen. Deze datum is gelijk aan de uiterste datum van de btw-aangifte over dezelfde periode.`,
  forWhom: 'Ondernemers die goederen of diensten leveren aan afnemers met een btw-nummer in een ander EU-land.',
  whatToDo: 'Dien de opgaaf ICP in via Mijn Belastingdienst Zakelijk, met het btw-identificatienummer van uw afnemers en de geleverde bedragen.',
  sourceName: 'Belastingdienst',
  sourceUrl: ICP_SOURCE.sourceUrl,
  lastVerified: ICP_SOURCE.lastVerified,
}));

const vennootschapsbelastingDeadlines: TaxDeadline[] = [
  {
    id: nextId('vpb'),
    taxType: 'vennootschapsbelasting',
    title: 'Aangifte vennootschapsbelasting – boekjaar 2025',
    period: 'Boekjaar 2025 (gelijk aan kalenderjaar)',
    deadline: '2026-06-01',
    recurrence: 'yearly',
    audiences: ['bv-dga'],
    description: 'Is uw boekjaar gelijk aan het kalenderjaar? Dan moet de aangifte vennootschapsbelasting vóór 1 juni van het volgende kalenderjaar zijn ingediend. Bij een gebroken boekjaar geldt: binnen 5 maanden na het einde van het boekjaar.',
    forWhom: 'BV\'s en andere vennootschapsbelastingplichtige rechtspersonen met een boekjaar gelijk aan het kalenderjaar.',
    whatToDo: 'Dien de aangifte in via Mijn Belastingdienst Zakelijk, met fiscale software of via uw fiscaal dienstverlener. Lukt dit niet op tijd? Vraag vóór 1 juni uitstel aan (online tot 1 november).',
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/aangifte-vennootschapsbelasting-doen/aangifte-vennootschapsbelasting-doen',
    lastVerified: '2026-09-25',
  },
  {
    id: nextId('vpb'),
    taxType: 'vennootschapsbelasting',
    title: 'Aangifte vennootschapsbelasting – boekjaar 2026',
    period: 'Boekjaar 2026 (gelijk aan kalenderjaar)',
    deadline: '2027-06-01',
    recurrence: 'yearly',
    audiences: ['bv-dga'],
    description: 'Is uw boekjaar gelijk aan het kalenderjaar? Dan moet de aangifte vennootschapsbelasting vóór 1 juni van het volgende kalenderjaar zijn ingediend. Bij een gebroken boekjaar geldt: binnen 5 maanden na het einde van het boekjaar.',
    forWhom: 'BV\'s en andere vennootschapsbelastingplichtige rechtspersonen met een boekjaar gelijk aan het kalenderjaar.',
    whatToDo: 'Dien de aangifte in via Mijn Belastingdienst Zakelijk, met fiscale software of via uw fiscaal dienstverlener. Lukt dit niet op tijd? Vraag vóór 1 juni uitstel aan (online tot 1 november).',
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/aangifte-vennootschapsbelasting-doen/aangifte-vennootschapsbelasting-doen',
    lastVerified: '2026-09-25',
  },
];

const inkomstenbelastingDeadlines: TaxDeadline[] = [
  {
    id: nextId('ib'),
    taxType: 'inkomstenbelasting',
    title: 'Aangifte inkomstenbelasting – belastingjaar 2025',
    period: 'Belastingjaar 2025',
    deadline: '2026-05-01',
    recurrence: 'yearly',
    audiences: ['zzp', 'bv-dga'],
    description: 'De aangifte inkomstenbelasting moet bij de Belastingdienst binnen zijn vóór de datum die in uw aangiftebrief staat. Volgens de Belastingdienst is dat vaak 1 mei; in de jaarlijkse aangifteperiode is de uiterste datum voor uitstel-aanvragen eveneens vóór 1 mei. Controleer altijd de exacte datum op uw eigen aangiftebrief.',
    forWhom: 'Zelfstandig ondernemers (eenmanszaak/zzp) en DGA\'s die zelf aangifte inkomstenbelasting moeten doen.',
    whatToDo: 'Dien uw aangifte online in via Mijn Belastingdienst (ondernemers mogen alleen online aangifte doen). Lukt dit niet op tijd? Vraag vóór 1 mei uitstel aan; u krijgt dan uitstel tot 1 september.',
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/belastingaangifte/content/wanneer-moet-ik-aangifte-doen',
    lastVerified: '2026-09-25',
  },
  {
    id: nextId('ib'),
    taxType: 'inkomstenbelasting',
    title: 'Aangifte inkomstenbelasting – belastingjaar 2026',
    period: 'Belastingjaar 2026',
    deadline: '2027-05-01',
    recurrence: 'yearly',
    audiences: ['zzp', 'bv-dga'],
    description: 'De aangifte inkomstenbelasting moet bij de Belastingdienst binnen zijn vóór de datum die in uw aangiftebrief staat. Volgens de Belastingdienst is dat vaak 1 mei. Controleer altijd de exacte datum op uw eigen aangiftebrief.',
    forWhom: 'Zelfstandig ondernemers (eenmanszaak/zzp) en DGA\'s die zelf aangifte inkomstenbelasting moeten doen.',
    whatToDo: 'Dien uw aangifte online in via Mijn Belastingdienst (ondernemers mogen alleen online aangifte doen). Lukt dit niet op tijd? Vraag vóór 1 mei uitstel aan; u krijgt dan uitstel tot 1 september.',
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/belastingaangifte/content/wanneer-moet-ik-aangifte-doen',
    lastVerified: '2026-09-25',
  },
];

const dividendbelastingDeadlines: TaxDeadline[] = [
  {
    id: nextId('divb'),
    taxType: 'dividendbelasting',
    title: 'Aangifte en betaling dividendbelasting',
    period: 'Doorlopend (geen vaste kalenderdatum)',
    deadline: null,
    recurrence: 'event',
    audiences: ['bv-dga'],
    description: 'De dividendbelasting kent geen vaste jaarlijkse of maandelijkse datum: u moet aangifte doen én betalen binnen 1 maand na de dag waarop u het dividend ter beschikking hebt gesteld aan de aandeelhouder(s).',
    forWhom: 'Vennootschappen (BV\'s) die dividend uitkeren aan aandeelhouders.',
    whatToDo: 'Bepaal de datum waarop u het dividend hebt uitgekeerd en dien binnen 1 maand daarna de aangifte in en betaal het ingehouden bedrag, via Mijn Belastingdienst Zakelijk of uw fiscaal dienstverlener.',
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/als_u_dividend_uitkeert/dividendbelasting-aangifte-betalen',
    lastVerified: '2026-09-25',
  },
];

export const taxDeadlines: TaxDeadline[] = [
  ...btwMonthlyDeadlines,
  ...btwQuarterlyDeadlines,
  ...btwYearlyDeadlines,
  ...loonheffingenMonthlyDeadlines,
  ...icpMonthlyDeadlines,
  ...vennootschapsbelastingDeadlines,
  ...inkomstenbelastingDeadlines,
  ...dividendbelastingDeadlines,
].sort((a, b) => {
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return a.deadline.localeCompare(b.deadline);
});
