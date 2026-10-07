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
//  - "sitemap": een Google News-sitemap ("sitemapUrl", xmlns:news) zonder
//    samenvattingstekst in de sitemap zelf — per nieuw artikel wordt de
//    paginabron zelf opgehaald om de meta-description (of og:description)
//    te lezen als brontekst voor de samenvatting — nooit verzonnen, altijd
//    de eigen tekst van de bron. Momenteel door geen actieve bron gebruikt.
//  - "rijksoverheid-topic-api": de Rijksoverheid-bron. Discovery via de
//    topic-API van rijksoverheid.nl (POST /api/search), per geconfigureerd
//    topic; elke kandidaat doorloopt daarna dezelfde artikelpagina-fetch en
//    relevantiepoort als het "sitemap"-type (zie processSitemapSource in
//    fetch-articles.mjs). Optioneel kan een "ministryBypass" ingesteld
//    worden: als de artikelpagina een breadcrumb-link naar die
//    ministerie-pagina bevat, telt het artikel als relevant ook zonder
//    trefwoordtreffer (zie extractMinistryTag).
//  - "kvk-sitemap": de KVK-bron (zie hieronder).
//
// Geschiedenis Rijksoverheid: rijksoverheid.nl is begin/medio 2026
// overgestapt op een nieuw technisch platform. Daarbij is de oude
// RSS-infrastructuur op feeds.rijksoverheid.nl buiten gebruik geraakt (het
// domein resolvet niet meer; herbevestigd 2026-10-01 met een live fetch).
// De officiële rijksoverheid.nl/service/rss-toelichtingspagina documenteert
// ook geen statische sitewide RSS-URL. De daarna gebruikte sitewide
// sitemap-discovery leverde vrijwel uitsluitend niet-relevant
// overheidsnieuws op en is op 2026-10-07 volledig verwijderd (zie
// git-historie); sindsdien is de topic-API de enige Rijksoverheid-route.
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

// Doelgroepen per artikel: net als categoryKeywords, maar dan om aan te
// geven voor welk type ondernemer een artikel vooral relevant is. Een
// artikel krijgt een doelgroep alleen toegekend bij een daadwerkelijke
// trefwoordtreffer in titel + samenvatting — nooit geraden. Een artikel kan
// meerdere doelgroepen hebben (bv. zowel "werkgever" als "mkb-ondernemer").
// De sleutels hier moeten gelijk zijn aan `audiences` in
// src/content/config.ts.
//
// Staat bewust vóór `sources` hieronder: de Rijksoverheid-bron
// (rijksoverheid-topic-api) verwijst naar rijksoverheidAudienceSignals (zie
// verderop) in haar eigen configuratie-object, en dat moet al geïnitialiseerd zijn op het moment
// dat die array-literal wordt geëvalueerd.
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

// Smalle, expliciete aanvulling op categoryKeywords, uitsluitend voor de
// Rijksoverheid-relevantiepoort (zie fetch-articles.mjs,
// processSitemapSource / source.audienceSignals hieronder). Een live
// productie-analyse (2026-10-01) liet zien dat "Zelfstandigenwet biedt meer
// duidelijkheid en erkenning voor zzp'ers" werd afgewezen, terwijl
// audienceKeywords.zzp dit artikel al als zzp-relevant herkende — alleen
// werd audienceKeywords nooit door de relevantiepoort geraadpleegd. Van
// alle audienceKeywords-groepen is uitsluitend zzp specifiek genoeg aan
// Avydo's doelgroep gekoppeld om als zelfstandig relevantiesignaal te
// dienen. Bewust NIET toegevoegd: werkgever/starter/mkb-ondernemer — die
// bevatten brede, generieke termen ("ondernemer", "werkgever", "personeel",
// "mkb") die massaal algemeen overheidsnieuws zouden doorlaten. Dit raakt
// alleen de Rijksoverheid-bron (rijksoverheid-topic-api); andere bronnen filteren nog steeds
// uitsluitend op categoryKeywords (+ ministryBypass waar van toepassing).
export const rijksoverheidAudienceSignals = audienceKeywords.zzp;

// Rijksoverheid-topic-specifieke aanvullingen op de relevantiepoort, na de
// inhoudelijke audit van de eerste twee productieruns van
// rijksoverheid-topic-api (2026-10-07). Bewust NIET in categoryKeywords:
// die lijst wordt gedeeld met o.a. KVK, en deze signalen zijn uitsluitend
// voor deze bron bedoeld (zie processSitemapSource in fetch-articles.mjs).
// Regelvorm: alle termen in `all` én (indien opgegeven) minstens één term in
// `any` moeten voorkomen; `scope: 'title'` beperkt de toets tot de titel;
// `unlessAny` heft een uitsluiting op als de tekst één van die termen bevat.
//
// Positief signaal: crypto + een concrete meld-/rapportageplicht richting de
// Belastingdienst. Nodig omdat zulke artikelen geen categoryKeyword bevatten
// en hun enige 'belasting' binnen 'Belastingdienst' valt, wat de
// ministryBypass bewust negeert (zie hasMinistryBypassRequiredTerm). Kaal
// 'crypto' is bewust niet voldoende.
//
// Werkgevers-/zzp-signalen (2026-10-07, offline audit "A″" over runs #32/#33
// en 329 Rijksoverheid-artikelen): werkgevers- en zzp-artikelen in SZW-taal
// bevatten geen fiscaal categoryKeyword en werden daardoor altijd afgewezen.
// Bewust alleen smalle combinaties — losse 'subsidie', 'boete', 'werkgever',
// 'arbeidsinspectie' of 'arbeidsmigrant' lieten in de audit verlopen
// subsidierondes (SOWIS) en politiek nieuws door.
//  - werkgeverssubsidie arbeidsbeperking;
//  - arbeidsongeschiktheidsverzekering zelfstandigen ('zelfstandigen' wordt
//    niet door audienceSignals gedekt; 'verzekering' houdt IOAZ-/
//    uitkeringsberichten buiten);
//  - uitleenmarkt (Wtta, zelfstandig signaal) en boetes voor illegale arbeid
//    of overtreding van arbeidswetten — twee aparte regels, omdat een regel
//    maar één `all` en één `any` kent.
// Optioneel `category`: categorie voor een artikel dat via déze regel
// relevant werd en geen categoryKeywords-treffer heeft (anders zou het op
// defaultCategory 'Fiscale actualiteit' terugvallen). Een categoryKeywords-
// treffer gaat altijd voor; de crypto-regel heeft bewust geen hint.
export const rijksoverheidTopicRelevanceSignals = [
  { all: ['crypto'], any: ['rapportageverplicht', 'delen met de belastingdienst'] },
  { all: ['arbeidsbeperking'], any: ['subsidie'], category: 'Personeel & loonheffingen' },
  { all: ['zelfstandigen', 'arbeidsongeschikt'], any: ['verzekering'], category: 'Ondernemen & rechtsvormen' },
  { any: ['wtta', 'terbeschikkingstelling van arbeidskrachten'], category: 'Personeel & loonheffingen' },
  { all: ['boete'], any: ['illegale arbeid', 'illegaal in dienst', 'arbeidswetten'], category: 'Personeel & loonheffingen' },
];

// Uitsluitingen, gelden ook als een ander signaal het artikel relevant
// maakte (bewezen false positives uit de audit):
//  - BES/Caribisch Nederland: alleen op de titel, zodat een terloopse
//    vermelding in een Nederlands artikel niet tot uitsluiting leidt.
//  - interne Belastingdienst-organisatie/IT: vereist de organisatie én een
//    specifieke organisatie-/IT-term; een gewone vermelding van de
//    Belastingdienst blijft dus toegestaan.
//  - consumentgerichte vliegbelasting, tenzij de tekst een ondernemers- of
//    werkgeverscomponent noemt.
export const rijksoverheidTopicExclusionRules = [
  { scope: 'title', any: ['caribisch nederland', 'bonaire', 'sint eustatius', 'sint-eustatius', 'bes-eilanden'] },
  {
    all: ['belastingdienst'],
    any: ['it-modernisering', 'modernisering belastingdienst', 'modernisering van de belastingdienst', 'capaciteitstekort', 'jaarplan belastingdienst'],
  },
  { any: ['vliegbelasting'], unlessAny: ['ondernemer', 'werkgever', 'bedrijven', 'mkb', 'zzp'] },
];

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
    id: 'rijksoverheid-topic-api',
    name: 'Rijksoverheid',
    type: 'rijksoverheid-topic-api',
    // De enige Rijksoverheid-bron van het Kenniscentrum. Discovery via de
    // Rijksoverheid topic-API (POST /api/search); de exacte
    // requestState/queryConfig-structuur is bevestigd via een live
    // gecapturede browser-request (zie git-historie). Uitsluitend de 12
    // hieronder bewust voor Avydo geselecteerde topics — geen andere topics
    // uit de algemene Rijksoverheid-topicstructuur (bijv. AOW, Anw, WIA,
    // Kinderbijslag, toeslagen of andere consument-/uitkeringsthema's).
    // Exacte topicnamen zoals de API ze accepteert, live geverifieerd in het
    // read-only topic-onderzoek (elk topic gaf resultaten), niet gegokt.
    topics: [
      'Belasting betalen',
      'Inkomstenbelasting',
      'Belastingverdragen',
      'Bijstand voor zelfstandigen (Bbz)',
      'Europese subsidies',
      'Prinsjesdag: Belastingplan 2027',
      'Aanpak belastingontwijking en belastingontduiking',
      'Zelfstandigen zonder personeel (zzp)',
      'Ziekteverzuim en herstel naar werk',
      'Werken met arbeidsbeperking',
      'Buitenlandse werknemers',
      'Ondernemen en innovatie',
    ],
    defaultCategory: 'Fiscale actualiteit',
    enabled: true,
    urlConfidence: 'confirmed',
    // Een topic-kandidaat is geen automatische publicatie: elke kandidaat
    // moet door dezelfde categoryKeywords-/ministryBypass-/audienceSignals-/
    // corroboratie-logica (zie processSitemapSource in fetch-articles.mjs).
    requireKeywordMatch: true,
    ministryBypass: 'Ministerie van Financiën',
    audienceSignals: rijksoverheidAudienceSignals,
    // Categorie voor een artikel dat via audienceSignals (zzp) relevant werd
    // zonder categoryKeywords-treffer — zie de category-hints bij
    // rijksoverheidTopicRelevanceSignals. Raakt de matching niet.
    audienceSignalsCategory: 'Ondernemen & rechtsvormen',
    corroborationRequiredKeywords: ['prinsjesdag'],
    relevanceSignals: rijksoverheidTopicRelevanceSignals,
    exclusionRules: rijksoverheidTopicExclusionRules,
    // Eigen, conservatieve discovery-grenzen voor de topic-API — los van
    // (en zonder wijziging aan) de bestaande RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN
    // in fetch-articles.mjs. 5 pagina's × 10 resultaten = maximaal 50
    // kandidaten per topic bevraagd; maxArticlesPerTopicPerRun begrenst
    // daarna hoeveel kandidaten per topic (meest recent eerst) daadwerkelijk
    // worden meegenomen.
    maxPagesPerTopic: 5,
    maxArticlesPerTopicPerRun: 20,
    // Bron-specifieke publicatielimiet per run (2026-10-07), in plaats van
    // de gedeelde maxArticlesPerSourcePerRun (10) hieronder: met 12 topics
    // en verwerking van nieuw naar oud bereikte de bron die limiet al na de
    // meest recente artikelen, waardoor 98 kandidaten onbeoordeeld bleven.
    // Belastingdienst en KVK houden de gedeelde limiet.
    maxArticlesPerSourcePerRun: 30,
    // Leeftijdsgrens (2026-10-07): kandidaten met een sort_date die meer dan
    // 24 kalendermaanden vóór de run ligt, worden niet verder geëvalueerd.
    // De derde productierun liet zien dat de resterende topic-wachtrij
    // vrijwel uitsluitend uit verouderde berichten bestaat (2018–2022), die
    // deels via bestaande trefwoorden als 'box 3'/'dividend' zouden worden
    // gepubliceerd. Zie isOutsideMaxAge in fetch-articles.mjs voor het
    // exacte grensgedrag.
    maxAgeMonths: 24,
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
// maar via requireKeywordMatch ook OF een artikel (bijv. van Rijksoverheid
// of KVK) überhaupt wordt opgenomen — bewust specifiek houden.
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
// Geldt voor elke bron zonder eigen maxArticlesPerSourcePerRun (momenteel
// Belastingdienst en KVK); de Rijksoverheid-bron heeft een eigen limiet
// van 30. Samen (10 + 30 + 10 = 50) kan het totaal van 45 hierboven daardoor
// wél bindend worden als Belastingdienst en Rijksoverheid in dezelfde run
// allebei veel publiceren; KVK (de laatste bron in de volgorde) krijgt dan
// minder dan 10.
export const maxArticlesPerSourcePerRun = 10;

export const articleRetentionDays = 270;
