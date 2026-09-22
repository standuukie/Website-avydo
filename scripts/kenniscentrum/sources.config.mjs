// Bronconfiguratie voor het Kenniscentrum.
//
// Dit bestand is de plek om bronnen toe te voegen, te verwijderen of aan/uit te
// zetten (zie README.md, sectie "Kenniscentrum beheren"). Elke bron is een
// officiële RSS-feed van een Nederlandse overheidsinstantie.
//
// Betrouwbaarheid van de URL's:
//  - "confirmed": de exacte URL kwam terug in zoekresultaten / is een bekend,
//    gedocumenteerd endpoint.
//  - "inferred": de URL volgt een bevestigd patroon (bv. andere feeds op
//    hetzelfde domein met dezelfde structuur) maar is niet 1-op-1 live
//    geverifieerd op het moment van schrijven. Het ophaalscript controleert
//    dit bij elke run vanzelf (ongeldige feeds worden overgeslagen, nooit
//    verzonnen) en rapporteert per bron of het ophalen lukte.

export const sources = [
  {
    id: 'belastingdienst-zakelijk',
    name: 'Belastingdienst',
    feedUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/rss/nieuwsfeed_actueel_zakelijk.xml',
    defaultCategory: 'Belastingen',
    enabled: true,
    urlConfidence: 'confirmed',
    // Deze feed is al specifiek voor ondernemers/intermediairs: geen extra
    // keywordfilter nodig, elk item wordt als relevant beschouwd.
    requireKeywordMatch: false,
  },
  {
    id: 'rijksoverheid-belastingen-ondernemers',
    name: 'Rijksoverheid',
    feedUrl: 'https://feeds.rijksoverheid.nl/onderwerpen/belastingen-voor-ondernemers/nieuws.rss',
    defaultCategory: 'Belastingen',
    enabled: true,
    urlConfidence: 'inferred',
    requireKeywordMatch: false,
  },
  {
    id: 'rijksoverheid-szw',
    name: 'Rijksoverheid (SZW)',
    feedUrl: 'https://feeds.rijksoverheid.nl/ministeries/ministerie-van-sociale-zaken-en-werkgelegenheid/nieuws.rss',
    defaultCategory: 'Personeel & loon',
    enabled: true,
    urlConfidence: 'confirmed',
    // Dit ministerie publiceert ook nieuws dat weinig met MKB-werkgeverschap
    // te maken heeft (bv. sociale zekerheid in brede zin) -> wel filteren.
    requireKeywordMatch: true,
  },
  {
    id: 'rijksoverheid-algemeen',
    name: 'Rijksoverheid',
    feedUrl: 'https://feeds.rijksoverheid.nl/nieuws.rss',
    defaultCategory: null,
    enabled: true,
    urlConfidence: 'confirmed',
    // Brede algemene nieuwsfeed van de hele Rijksoverheid: strikt filteren
    // op relevantie is hier essentieel, anders komt er te veel niet-MKB
    // nieuws doorheen.
    requireKeywordMatch: true,
  },
];

// Trefwoorden per categorie. Een artikel krijgt een categorie toegewezen op
// basis van het aantal treffers in titel + samenvatting. Bronnen met
// requireKeywordMatch:true worden alleen opgenomen als er in minstens één
// categorie een treffer is.
export const categoryKeywords = {
  Belastingen: [
    'belasting', 'btw', 'omzetbelasting', 'inkomstenbelasting', 'vennootschapsbelasting',
    'vpb', 'aangifte', 'aanslag', 'belastingplan', 'prinsjesdag', 'belastingdienst',
    'heffing', 'fiscaal', 'fiscale', 'toeslag', 'box 1', 'box 2', 'box 3',
  ],
  'Personeel & loon': [
    'loon', 'loonheffing', 'payroll', 'werkgever', 'werknemer', 'arbeidsrecht',
    'cao', 'minimumloon', 'arbeidsovereenkomst', 'ontslag', 'ziekteverzuim',
    'pensioen', 'arbeidsmarkt', 'zzp', 'personeel',
  ],
  Ondernemen: [
    'ondernemer', 'ondernemen', 'mkb', 'midden- en kleinbedrijf', 'starter',
    'zzp', 'bedrijfsvoering', 'kvk', 'kamer van koophandel',
  ],
  'Wet- en regelgeving': [
    'wet', 'wetswijziging', 'regelgeving', 'wetsvoorstel', 'wettelijk',
    'verplicht', 'wetgeving', 'besluit', 'richtlijn',
  ],
  Subsidies: [
    'subsidie', 'subsidieregeling', 'tegemoetkoming', 'financieringsregeling',
    'steunmaatregel', 'investeringsregeling',
  ],
  Financiën: [
    'financiering', 'jaarrekening', 'verslaggeving', 'rentetarief', 'inflatie',
    'begroting', 'overheidsfinanciën', 'economie', 'economische',
  ],
  Accountancy: [
    'accountant', 'accountancy', 'jaarrekening', 'controle', 'nba',
    'boekhoud', 'administratie', 'verslaggeving',
  ],
};

// Trefwoorden die duiden op een belangrijke wijziging (i.t.t. een kleine
// technische aanpassing). Gebruikt om priority=belangrijk toe te kennen.
export const importantKeywords = [
  'prinsjesdag', 'belastingplan', 'wetswijziging', 'per 1 januari', 'nieuwe wet',
  'verplicht per', 'wijziging in', 'kabinet', 'wetsvoorstel', 'afschaffing',
  'verhoging', 'verlaging',
];

export const maxArticlesPerRun = 30;
export const articleRetentionDays = 270;
