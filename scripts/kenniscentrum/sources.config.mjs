// Bronconfiguratie voor het Kenniscentrum.
//
// Dit bestand is de plek om bronnen toe te voegen, te verwijderen of aan/uit te
// zetten (zie README.md, sectie "Kenniscentrum beheren"). Elke bron is een
// officiële feed of sitemap van een Nederlandse overheidsinstantie.
//
// Bron-types:
//  - "rss": een RSS/Atom-feed, opgehaald en geparsed als XML-items met
//    title/link/description/pubDate.
//  - "sitemap": een Google News-sitemap (xmlns:news), die alleen recent
//    gepubliceerde nieuwsartikelen bevat (title, publicatiedatum, canonieke
//    URL) maar geen samenvattingstekst. Voor dit type wordt per nieuw
//    artikel de paginabron zelf opgehaald om de meta-description (of
//    og:description) te lezen als brontekst voor de samenvatting — nooit
//    verzonnen, altijd de eigen tekst van de bron.
//
// Geschiedenis / waarom rijksoverheid-nieuws een sitemap gebruikt in plaats
// van RSS: rijksoverheid.nl is begin/medio 2026 overgestapt op een nieuw
// technisch platform. Daarbij is de oude RSS-infrastructuur op
// feeds.rijksoverheid.nl buiten gebruik geraakt (het domein resolvet niet
// meer; bevestigd in de logs van de automatische run op 2026-09-22 en
// 2026-09-23: alle drie de feeds.rijksoverheid.nl-URL's faalden met
// "fetch failed", terwijl de Belastingdienst-feed in dezelfde runs gewoon
// werkte). Rijksoverheid.nl publiceert zelf een officiële, live-geverifieerde
// Google News-sitemap op https://www.rijksoverheid.nl/news/sitemap.xml
// (onderdeel van https://www.rijksoverheid.nl/sitemap.xml) die als directe,
// stabiele bron dient — geen zoekmachine of scraping nodig.
//
// Betrouwbaarheid van de URL's:
//  - "confirmed": de exacte URL is live geverifieerd (rechtstreeks getest,
//    niet via een zoekmachine).
//  - "inferred": de URL volgt een bevestigd patroon maar is niet 1-op-1 live
//    geverifieerd op het moment van schrijven. Het ophaalscript controleert
//    dit bij elke run vanzelf (ongeldige feeds worden overgeslagen, nooit
//    verzonnen) en rapporteert per bron of het ophalen lukte.

export const sources = [
  {
    id: 'belastingdienst-zakelijk',
    name: 'Belastingdienst',
    type: 'rss',
    feedUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/berichten/nieuws/rss/nieuwsfeed_actueel_zakelijk.xml',
    defaultCategory: 'Belastingen',
    enabled: true,
    urlConfidence: 'confirmed',
    // Deze feed is al specifiek voor ondernemers/intermediairs: geen extra
    // keywordfilter nodig, elk item wordt als relevant beschouwd.
    requireKeywordMatch: false,
  },
  {
    id: 'rijksoverheid-nieuws',
    name: 'Rijksoverheid',
    type: 'sitemap',
    sitemapUrl: 'https://www.rijksoverheid.nl/news/sitemap.xml',
    defaultCategory: null,
    enabled: true,
    urlConfidence: 'confirmed',
    // Sitewide nieuws-sitemap van de hele Rijksoverheid (alle ministeries):
    // strikt filteren op brede MKB-relevantie is hier essentieel, anders
    // komt er te veel niet-ondernemersnieuws doorheen (zie categoryKeywords
    // hieronder, expliciet verbreed voorbij alleen belasting/btw/ondernemer).
    requireKeywordMatch: true,
  },
];

// Trefwoorden per categorie. Een artikel krijgt een categorie toegewezen op
// basis van het aantal treffers in titel + samenvatting. Bronnen met
// requireKeywordMatch:true worden alleen opgenomen als er in minstens één
// categorie een treffer is.
//
// Bewust breder dan alleen klassieke belastingtermen: het Kenniscentrum is
// voor Nederlandse MKB-ondernemers in brede zin, dus ook arbeidsrecht,
// digitalisering/e-facturatie, subsidies, duurzaamheid, privacy en
// EU-regelgeving met gevolgen voor bedrijven horen hierbij. Een relevant
// Rijksoverheid-artikel mag niet worden weggefilterd alleen omdat het geen
// klassiek belastingonderwerp is.
export const categoryKeywords = {
  Belastingen: [
    'belasting', 'btw', 'omzetbelasting', 'inkomstenbelasting', 'vennootschapsbelasting',
    'vpb', 'aangifte', 'aanslag', 'belastingplan', 'prinsjesdag', 'belastingdienst',
    'heffing', 'fiscaal', 'fiscale', 'fiscaliteit', 'toeslag', 'box 1', 'box 2', 'box 3',
  ],
  'Personeel & loon': [
    'loon', 'loonheffing', 'payroll', 'werkgever', 'werknemer', 'arbeidsrecht',
    'cao', 'minimumloon', 'arbeidsovereenkomst', 'arbeidsvoorwaarden', 'ontslag',
    'ziekteverzuim', 'pensioen', 'arbeidsmarkt', 'zzp', 'personeel',
    'sociale zekerheid', 'werkgeverschap',
  ],
  Ondernemen: [
    'ondernemer', 'ondernemen', 'mkb', 'midden- en kleinbedrijf', 'starter',
    'zzp', 'bedrijfsvoering', 'kvk', 'kamer van koophandel', 'zakendoen',
    'ondernemersplein', 'bedrijfsleven', 'administratieve verplichting',
    'administratieve lasten',
  ],
  'Wet- en regelgeving': [
    'wet', 'wetswijziging', 'regelgeving', 'wetsvoorstel', 'wettelijk',
    'verplicht', 'wetgeving', 'besluit', 'richtlijn', 'eu-richtlijn',
    'europese richtlijn', 'eu-verordening', 'europese regelgeving',
    'implementatiewet', 'compliance',
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
    'boekhoud', 'administratie', 'verslaggeving', 'financiële administratie',
  ],
  Digitalisering: [
    'e-facturatie', 'efactureren', 'digitalisering', 'digitaal', 'rapportage',
    'rapportageverplichting', 'rapportageverplichtingen', 'gegevensuitwisseling',
    'gegevensbescherming', 'avg', 'privacy', 'cybersecurity',
  ],
  Duurzaamheid: [
    'duurzaamheid', 'verduurzaming', 'csrd', 'klimaat', 'duurzaam ondernemen',
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

// Voorkomt dat één bron in haar eentje (bijna) het hele budget opsoupeert
// als die op een dag veel nieuwe items heeft — elke bron krijgt zo altijd
// ruimte, ook als een andere bron toevallig een grote achterstand inhaalt.
export const maxArticlesPerSourcePerRun = 10;

export const articleRetentionDays = 270;
