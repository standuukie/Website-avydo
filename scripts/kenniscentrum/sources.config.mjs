// Bronconfiguratie voor het Kenniscentrum.
//
// Dit bestand is de plek om bronnen toe te voegen, te verwijderen of aan/uit te
// zetten (zie README.md, sectie "Kenniscentrum beheren"). Elke bron is een
// officiële feed of sitemap van een Nederlandse organisatie relevant voor
// MKB-ondernemers.
//
// Bron-types:
//  - "rss": een RSS/Atom-feed, opgehaald en geparsed als XML-items met
//    title/link/description/pubDate.
//  - "sitemap": een Google News-sitemap (xmlns:news), die alleen recent
//    gepubliceerde nieuwsartikelen bevat (title, publicatiedatum, canonieke
//    URL) maar geen samenvattingstekst. Voor dit type wordt per nieuw
//    artikel de paginabron zelf opgehaald om de meta-description (of
//    og:description) te lezen als brontekst voor de samenvatting — nooit
//    verzonnen, altijd de eigen tekst van de bron. Optioneel kan een
//    "ministryBypass" ingesteld worden: als de artikelpagina een
//    breadcrumb-link naar die ministerie-pagina bevat, telt het artikel
//    als relevant ook zonder trefwoordtreffer (zie fetch-articles.mjs,
//    extractMinistryTag).
//
// Geschiedenis / waarom rijksoverheid-nieuws een sitemap gebruikt in plaats
// van RSS: rijksoverheid.nl is begin/medio 2026 overgestapt op een nieuw
// technisch platform. Daarbij is de oude RSS-infrastructuur op
// feeds.rijksoverheid.nl buiten gebruik geraakt (het domein resolvet niet
// meer; bevestigd in productielogs). Rijksoverheid.nl publiceert zelf een
// officiële, live-geverifieerde Google News-sitemap op
// https://www.rijksoverheid.nl/news/sitemap.xml die als directe, stabiele
// bron dient — geen zoekmachine of scraping nodig. Om specifiek publicaties
// van het Ministerie van Financiën te kunnen tonen (naast de bestaande
// brede trefwoordfilter) wordt op de artikelpagina zelf gecontroleerd op de
// breadcrumb-link naar /ministeries/ministerie-van-financien; is die
// aanwezig, dan telt het artikel als relevant ongeacht trefwoordtreffer.
//
// Onderzochte maar NIET geïntegreerde bronnen (december 2026-uitbreiding),
// telkens na daadwerkelijk live testen vanaf een omgeving met
// internettoegang (niet via een zoekmachine of giswerk):
//  - KVK (kvk.nl/overzicht/): geen RSS, geen sitemap die het overzicht
//    dekt (sitemap_index.xml bevat alleen statische pagina's en WOO-
//    documentcategorieën). De overzichtspagina is een Next.js-app die zijn
//    content client-side ophaalt bij een intern, ongedocumenteerd
//    Bloomreach-CMS-endpoint (production-site-nl.kvk.bloomreach.cloud) —
//    dat is geen publieke, voor derden bedoelde API en wordt daarom niet
//    gebruikt (zou neerkomen op reverse-engineering van hun interne SPA-
//    backend, niet wezenlijk anders dan een niet-toegestane workaround).
//  - NBA (nba.nl/nieuws/): geen RSS (/rss, /nieuws/rss beide 404), de
//    sitemap.xml (555KB) bevat geen individuele nieuwsartikel-URL's, en de
//    nieuws-indexpagina levert geen server-gerenderde artikel-links op om
//    te parsen (waarschijnlijk client-side gerenderd). Geen officiële,
//    stabiele methode beschikbaar.
//  - FD (fd.nl/economie): heeft wél een werkende RSS-feed
//    (fd.nl/laatste-nieuws?rss=), maar zowel de feed zelf ("intended
//    solely for personal, non-commercial use") als robots.txt van fd.nl
//    ("All use of FD content is subject to the Terms & Conditions...
//    Prohibited uses include ... (4) any commercial purposes") sluiten
//    gebruik op een commerciële website als deze expliciet uit. Dit is
//    geen technische maar een juridische blokkade en wordt gerespecteerd.
//  - Gemeente Venray (venray.nl/nieuwsoverzicht): geen RSS, geen
//    nieuws-specifieke sitemap (alleen een algemene, gemengde sitemap.xml
//    zonder onderscheid tussen nieuwsartikelen en statische infopagina's —
//    beide gebruiken dezelfde platte URL-structuur, dus niet betrouwbaar
//    te filteren op "is dit nieuws"). Daarnaast blokkeerde de bot-
//    bescherming van de site herhaaldelijk verzoeken (403 "The request is
//    blocked"), ook met een browser-useragent, wat onbetrouwbaar is voor
//    een onbeheerde dagelijkse job.
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
    // komt er te veel niet-ondernemersnieuws doorheen.
    requireKeywordMatch: true,
    // Publicaties van het Ministerie van Financiën tellen altijd als
    // relevant, ook zonder trefwoordtreffer (zie extractMinistryTag).
    ministryBypass: 'Ministerie van Financiën',
  },
  {
    id: 'mkb-nederland-nieuws',
    name: 'MKB-Nederland',
    type: 'rss',
    feedUrl: 'https://www.mkb.nl/rss/nieuws-mkb-nederland',
    defaultCategory: 'Ondernemen',
    enabled: true,
    urlConfidence: 'confirmed',
    // Dit is al de eigen, specifieke nieuwsfeed van MKB-Nederland (niet hun
    // algemene/agenda/blog-feeds) — net als bij de Belastingdienst is een
    // extra keywordfilter hier niet nodig: het is per definitie
    // ondernemersnieuws (ondernemersklimaat, economie, regelgeving,
    // arbeidsmarkt).
    requireKeywordMatch: false,
  },
];

// Trefwoorden per categorie. Een artikel krijgt een categorie toegewezen op
// basis van het aantal treffers in titel + samenvatting. Bronnen met
// requireKeywordMatch:true worden alleen opgenomen als er in minstens één
// categorie een treffer is.
//
// Bewust breder dan alleen klassieke belastingtermen: het Kenniscentrum is
// voor Nederlandse MKB-ondernemers in brede zin, dus ook arbeidsrecht,
// digitalisering/AI/e-facturatie, subsidies, duurzaamheid, privacy, fraude,
// import/export en EU-regelgeving met gevolgen voor bedrijven horen hierbij.
// Een relevant artikel mag niet worden weggefilterd alleen omdat het geen
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
    'ziekteverzuim', 're-integratie', 'pensioen', 'arbeidsmarkt', 'zzp', 'personeel',
    'sociale zekerheid', 'werkgeverschap', 'arbeidsproductiviteit',
  ],
  Ondernemen: [
    'ondernemer', 'ondernemen', 'mkb', 'midden- en kleinbedrijf', 'starter',
    'zzp', 'bedrijfsvoering', 'bedrijven', 'kvk', 'kamer van koophandel', 'zakendoen',
    'ondernemersplein', 'ondernemersregeling', 'bedrijfsleven', 'bedrijfsovername',
    'faillissement', 'faillissementen', 'handel', 'import', 'export',
    'vergunning', 'vergunningen', 'administratieve verplichting', 'administratieve lasten',
  ],
  'Wet- en regelgeving': [
    'wet', 'wetswijziging', 'regelgeving', 'wetsvoorstel', 'wettelijk',
    'verplicht', 'wetgeving', 'besluit', 'richtlijn', 'eu-richtlijn',
    'europese richtlijn', 'eu-verordening', 'europese regelgeving',
    'implementatiewet', 'compliance', 'fraude',
  ],
  Subsidies: [
    'subsidie', 'subsidieregeling', 'tegemoetkoming', 'financieringsregeling',
    'steunmaatregel', 'investeringsregeling',
  ],
  Financiën: [
    'financiering', 'jaarrekening', 'verslaggeving', 'rente', 'rentetarief', 'inflatie',
    'begroting', 'overheidsfinanciën', 'economie', 'economische', 'investeringen',
  ],
  Accountancy: [
    'accountant', 'accountancy', 'jaarrekening', 'audit', 'controle', 'nba',
    'boekhoud', 'administratie', 'verslaggeving', 'financiële administratie',
  ],
  Digitalisering: [
    'e-facturatie', 'efactureren', 'digitalisering', 'digitaal', 'rapportage',
    'rapportageverplichting', 'rapportageverplichtingen', 'gegevensuitwisseling',
    'gegevensbescherming', 'avg', 'privacy', 'cybersecurity',
    'kunstmatige intelligentie', 'ai-verordening',
  ],
  Duurzaamheid: [
    'duurzaamheid', 'verduurzaming', 'csrd', 'klimaat', 'duurzaam ondernemen', 'energie',
  ],
};

// Trefwoorden die duiden op een belangrijke wijziging (i.t.t. een kleine
// technische aanpassing). Gebruikt om priority=belangrijk toe te kennen.
export const importantKeywords = [
  'prinsjesdag', 'belastingplan', 'wetswijziging', 'per 1 januari', 'nieuwe wet',
  'verplicht per', 'wijziging in', 'kabinet', 'wetsvoorstel', 'afschaffing',
  'verhoging', 'verlaging',
];

// Verhoogd van 30 naar 45 bij de uitbreiding naar een derde bron
// (MKB-Nederland), zodat drie bronnen elk daadwerkelijk ruimte krijgen
// binnen één run in plaats van dat het totaal een kunstmatig plafond wordt.
export const maxArticlesPerRun = 45;

// Voorkomt dat één bron in haar eentje (bijna) het hele budget opsoupeert
// als die op een dag veel nieuwe items heeft — elke bron krijgt zo altijd
// ruimte, ook als een andere bron toevallig een grote achterstand inhaalt.
// Bij 3 bronnen × 10 = 30, ruim binnen het totaal van 45, dus het totaal
// wordt in de praktijk niet de bottleneck.
export const maxArticlesPerSourcePerRun = 10;

export const articleRetentionDays = 270;
