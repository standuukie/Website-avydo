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
// KVK-source (toegevoegd 2026-10-01, Fase 1 — integratie + dry-run):
// kvk.nl/overzicht/ zelf heeft geen RSS en haalt zijn content client-side op
// bij een intern, ongedocumenteerd CMS-endpoint (niet gebruikt — zie
// hieronder). Een tijdelijke, geïsoleerde GitHub Actions-proef (4 rondes)
// heeft echter vastgesteld dat de publieke sitemap_index.xml verwijst naar
// 10 documents-*.xml-sub-sitemaps met in totaal 1.837 URL's, allemaal met
// een geldige <lastmod>, en dat bekende, actuele artikelen daarin
// daadwerkelijk terug te vinden zijn. Dit is de discovery-bron (zie
// fetchKvkDocumentUrls/selectKvkCandidates in fetch-articles.mjs). lastmod
// is bevestigd een "laatst gewijzigd"-signaal, geen bewezen
// publicatiedatum — individuele artikelpagina's leveren geen betrouwbare
// publicatiedatum of JSON-LD op, en de <title> van KVK-pagina's wordt niet
// betrouwbaar per pagina gerenderd (daarom wordt de zichtbare <h1>
// gebruikt, nooit <title> — zie extractKvkArticleFields). De bron staat
// bewust op enabled:false tot de Fase 1-dry-run (dry-run-kvk.mjs) is
// beoordeeld.
//
// Onderzochte maar NIET geïntegreerde bronnen, telkens na daadwerkelijk
// live testen vanaf een omgeving met internettoegang (niet via een
// zoekmachine of giswerk):
//  - KVK, de client-side Next.js-overzichtspagina zelf: content komt van
//    een intern, ongedocumenteerd Bloomreach-CMS-endpoint
//    (production-site-nl.kvk.bloomreach.cloud) — geen publieke, voor derden
//    bedoelde API en daarom niet gebruikt (zou neerkomen op
//    reverse-engineering van hun interne SPA-backend). De documents-*.xml-
//    sitemaps hierboven zijn wél een publieke, legitieme bron.
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
    defaultCategory: 'Fiscale actualiteit',
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
    defaultCategory: 'Fiscale actualiteit',
    enabled: true,
    urlConfidence: 'confirmed',
    // Sitewide nieuws-sitemap van de hele Rijksoverheid (alle ministeries):
    // strikt filteren is hier essentieel. Sinds de redactionele aanscherping
    // (2026-10-01, zie categoryKeywords hieronder) is deze filtering
    // bewust smal gehouden tot échte accountancy-/fiscale termen, nadat
    // bleek dat brede trefwoorden als "wet"/"wetsvoorstel" volstrekt
    // onrelevant overheidsnieuws doorlieten (bijv. gemeentelijke
    // herindeling, bestuursbenoemingen op Bonaire, lijkbezorgingswetgeving).
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
    defaultCategory: 'Fiscale actualiteit',
    enabled: true,
    urlConfidence: 'confirmed',
    // Aangescherpt op 2026-10-01: deze feed bevat overwegend politieke
    // lobby-standpunten en algemeen ondernemersnieuws (stikstof, cao-
    // overleg, conjunctuurcijfers) die niet specifiek over accountancy of
    // belastingen gaan — dat paste niet bij een kenniscentrum van een
    // accountants- en belastingadvieskantoor. Voortaan telt een item van
    // deze bron alleen mee bij een treffer op een daadwerkelijk fiscaal/
    // accountancy-trefwoord (zie categoryKeywords hieronder).
    requireKeywordMatch: true,
  },
  {
    id: 'kvk-kennisartikelen',
    name: 'KVK',
    type: 'kvk-sitemap',
    sitemapIndexUrl: 'https://www.kvk.nl/sitemap_index.xml',
    defaultCategory: 'Ondernemen & rechtsvormen',
    // Geactiveerd op 2026-10-01 na 5 dry-run-rondes via de "KVK dry-run
    // (Kenniscentrum)"-workflow (zie de toelichting hierboven en
    // dry-run-kvk.mjs). Ronde 5 bevestigde: sterke fiscale/accountancy-
    // artikelen (KOR, btw, IB, Vpb, DGA, DBA, Prinsjesdag) en inhoudelijke
    // jaarrekeningartikelen blijven behouden, /producten-bestellen/ en
    // /pers/ volledig uitgesloten, overlapcontrole werkt correct.
    enabled: true,
    urlConfidence: 'confirmed',
    // Documents-*.xml bevat alle KVK-content door elkaar (ook
    // handelsregister-/productpagina's, evenementen, persberichten). Filteren
    // gebeurt in twee stappen — eerst op de URL-slug, daarna op de
    // daadwerkelijke titel + samenvatting — met dezelfde categoryKeywords als
    // de andere bronnen (zie processKvkSource/selectKvkCandidates).
    //
    // Aangescherpt 2026-10-01 (na de eerste dry-run): categoryKeywords alleen
    // was niet genoeg — formulieren/procedurepagina's als "Formulier 1:
    // Eenmanszaak inschrijven" of "Jaarrekeningen opvragen" bevatten
    // toevallig dezelfde trefwoorden als echte artikelen. Toegevoegd:
    // kvkProcedureKeywords/isKvkProcedurePage, een negatieve trefwoordlijst
    // (formulier, inschrijf/uitschrijf, convenant, rekentool, autorisatie,
    // opvragen, aanvragen, uittreksel, machtig) die zowel in de URL-
    // vóórfilter als in het eindfilter op titel+samenvatting wordt
    // toegepast.
    //
    // Verder aangescherpt 2026-10-01 (na de tweede dry-run): een kale
    // categoryKeywords-treffer bleek nog steeds te ruim — algemene
    // KVK-onderwerpen als "Hoe werkt een faillissement?", "Schulden oplossen
    // bij een eenmanszaak" en "Wat is een rechtsvorm?" bevatten dezelfde
    // trefwoorden als echte fiscale/accountancy-artikelen. Toegevoegd:
    // classifyKvkRelevance (een redactionele laag met sterke fiscale
    // signalen, vergelijkende-rechtsvorm-signalen en een lijst algemene
    // KVK-onderwerpen die alleen met een sterk signaal alsnog meetellen),
    // isKvkHubPage (sluit /onderwerp/...-overzichtspagina's uit), een
    // rangschikking op tier+lastmod vóór het ophalen van pagina's (i.p.v.
    // simpelweg de 50 meest recente), en een overlapcontrole tegen bestaande
    // Kenniscentrum-artikelen (findOverlappingArticle). Zie
    // fetch-articles.mjs voor de volledige implementatie.
    requireKeywordMatch: true,
  },
];

// Trefwoorden per categorie. Een artikel krijgt een categorie toegewezen op
// basis van het aantal treffers in titel + samenvatting. Bronnen met
// requireKeywordMatch:true worden alleen opgenomen als er in minstens één
// categorie een treffer is.
//
// Herzien op 2026-10-01 (redactionele aanscherping naar "het kenniscentrum
// van een accountants- en belastingadvieskantoor"): bewust SMAL gehouden
// tot termen die daadwerkelijk op accountancy, belastingen of fiscale
// compliance duiden. De eerdere, bredere opzet (generieke termen als "wet",
// "ondernemer", "bedrijven", "economie") liet veel te veel niet-fiscaal
// overheids- en lobbynieuws door — zie het Kenniscentrum-auditrapport van
// 2026-10-01. Let op: deze trefwoorden bepalen niet alleen de categorie,
// maar via requireKeywordMatch ook OF een artikel (van Rijksoverheid of
// MKB-Nederland) überhaupt wordt opgenomen — bewust specifiek houden.
export const categoryKeywords = {
  'Fiscale actualiteit': [
    'belastingplan', 'prinsjesdag', 'miljoenennota', 'fiscale wetswijziging',
    'belastingwetgeving', 'belastingtarief', 'belastingtarieven', 'motorrijtuigenbelasting',
    'accijns', 'invoerheffing', 'douane', 'bpm',
  ],
  Inkomstenbelasting: [
    'inkomstenbelasting', 'box 1', 'box 2', 'box 3', 'ondernemersaftrek',
    'zelfstandigenaftrek', 'startersaftrek', 'mkb-winstvrijstelling', 'heffingskorting',
    'urencriterium',
  ],
  Btw: [
    'btw', 'omzetbelasting', 'btw-aangifte', 'btw-tarief', 'kleineondernemersregeling',
    'kor', 'voorbelasting',
  ],
  'BV & DGA': [
    'dga', 'directeur-grootaandeelhouder', 'gebruikelijk loon', 'gebruikelijkloonregeling',
    'dividendbelasting', 'dividend', 'rekening-courant', 'aanmerkelijk belang', 'holdingstructuur',
  ],
  Vennootschapsbelasting: [
    'vennootschapsbelasting', 'vpb', 'fiscale winst', 'minimumbelasting', 'pijler 2',
  ],
  'Personeel & loonheffingen': [
    'loonheffing', 'loonheffingen', 'payroll', 'minimumloon', 'werkkostenregeling', 'wkr',
    'cao', 'arbeidsovereenkomst', 'loonbelasting', 'pensioenpremie', 're-integratie',
    'ziekteverzuim', 'loonaangifte',
  ],
  'Administratie & jaarrekening': [
    'jaarrekening', 'deponeren', 'administratieplicht', 'boekhoud', 'financiële administratie',
    'accountantscontrole', 'accountant', 'accountancy', 'nba', 'audit', 'jaarverslaggeving',
    'e-facturatie', 'efactureren',
  ],
  'Ondernemen & rechtsvormen': [
    'eenmanszaak', 'besloten vennootschap', 'rechtsvorm', 'bv oprichten', 'bv omzetten',
    'bedrijfsovername', 'fusie', 'overname', 'faillissement', 'vof', 'maatschap',
    // Toegevoegd 2026-10-01 (KVK-redactionele aanscherping, ronde 3): deze
    // categorie had t/m dan geen enkel zzp-/DBA-trefwoord, waardoor een
    // inhoudelijk artikel over schijnzelfstandigheid nergens op scoorde en
    // dus altijd werd afgewezen — ook als het expliciet fiscaal relevant
    // was. Puur additief: bestaande matches/gedrag voor andere bronnen
    // (Belastingdienst/Rijksoverheid/MKB-Nederland) blijven ongewijzigd,
    // dit voegt alleen herkenning toe voor content die voorheen nergens op
    // scoorde.
    'schijnzelfstandigheid', 'dba', 'zzp-wetgeving',
  ],
};

// Doelgroepen per artikel: net als categoryKeywords, maar dan om aan te
// geven voor welk type ondernemer een artikel vooral relevant is. Een
// artikel krijgt een doelgroep alleen toegekend bij een daadwerkelijke
// trefwoordtreffer in titel + samenvatting — nooit geraden. Een artikel kan
// meerdere doelgroepen hebben (bv. zowel "werkgever" als "mkb-ondernemer").
// De sleutels hier moeten gelijk zijn aan `audiences` in
// src/content/config.ts.
export const audienceKeywords = {
  zzp: ['zzp', "zzp'er", 'zzper', 'zelfstandige zonder personeel', 'eenmanszaak', 'zelfstandig ondernemer'],
  'bv-dga': ['dga', 'besloten vennootschap', 'vennootschapsbelasting', 'vpb', 'dividend', 'aandeelhouder', 'rechtspersoon'],
  werkgever: [
    'werkgever', 'personeel', 'loonheffing', 'payroll', 'cao', 'arbeidsovereenkomst',
    'minimumloon', 'arbeidsrecht', 'werknemer', 'werknemers', 'ontslag', 're-integratie',
  ],
  starter: ['starter', 'startende ondernemer', 'starten met een bedrijf', 'nieuwe onderneming', 'kvk-inschrijving', 'oprichting van een bedrijf'],
  'mkb-ondernemer': ['mkb', 'midden- en kleinbedrijf', 'ondernemer', 'ondernemers', 'ondernemen', 'bedrijfsleven'],
};

// Weergavenamen voor de doelgroepen, gebruikt in de frontend
// (src/lib/kenniscentrum.ts) en gelijk gehouden aan deze sleutels.
export const audienceLabels = {
  zzp: "ZZP'er",
  'bv-dga': 'BV / DGA',
  werkgever: 'Werkgever',
  starter: 'Starter',
  'mkb-ondernemer': 'MKB-ondernemer',
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
