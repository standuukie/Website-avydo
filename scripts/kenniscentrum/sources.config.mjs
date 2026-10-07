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
//  - "sitemap": een sitemap-gebaseerde bron zonder samenvattingstekst in de
//    sitemap zelf — per nieuw artikel wordt de paginabron zelf opgehaald om
//    de meta-description (of og:description) te lezen als brontekst voor de
//    samenvatting, en (als de sitemap zelf geen titel levert) ook de
//    paginatitel — nooit verzonnen, altijd de eigen tekst van de bron.
//    Optioneel kan een "ministryBypass" ingesteld worden: als de
//    artikelpagina een breadcrumb-link naar die ministerie-pagina bevat,
//    telt het artikel als relevant ook zonder trefwoordtreffer (zie
//    fetch-articles.mjs, extractMinistryTag). Twee discovery-varianten:
//    - "sitemapUrl": één Google News-sitemap (xmlns:news) met title +
//      publicatiedatum per item, rechtstreeks geparsed.
//    - "sitemapIndexUrl" + "articleUrlPattern": een sitemap-index die naar
//      meerdere sub-sitemaps verwijst (zie rijksoverheid-nieuws hieronder);
//      sub-sitemaps bevatten alleen loc+lastmod, dus de titel komt van de
//      artikelpagina zelf, net als de samenvatting.
//
// Geschiedenis rijksoverheid-nieuws: rijksoverheid.nl is begin/medio 2026
// overgestapt op een nieuw technisch platform. Daarbij is de oude
// RSS-infrastructuur op feeds.rijksoverheid.nl buiten gebruik geraakt (het
// domein resolvet niet meer; herbevestigd 2026-10-01 met een live fetch
// vanuit een omgeving mét internettoegang tot rijksoverheid.nl — zie
// hieronder). De officiële rijksoverheid.nl/service/rss-toelichtingspagina
// (eveneens live gecontroleerd) documenteert ook geen statische sitewide
// RSS-URL: RSS is daar uitsluitend per pagina/onderwerp beschikbaar via een
// "Abonneren"-knop die de link pas client-side in een pop-up genereert —
// geen bruikbaar alternatief voor een onbeheerde dagelijkse job.
//
// Aangepast 2026-10-01 (observability → discovery-uitbreiding): de
// voorheen gebruikte Google News-sitemap (news/sitemap.xml) bleek bij live
// onderzoek slechts ~7 items per run op te leveren, uitsluitend van de
// afgelopen ~24 uur — een eigenschap van het Google News-sitemapformaat
// zelf (dat formaat is uitdrukkelijk bedoeld voor zeer recent nieuws), geen
// bug in dit script en geen beperking van rijksoverheid.nl's content.
// Live onderzoek (tijdelijke, alleen-lezen GitHub Actions dry-run, zie
// git-historie) stelde vast dat https://www.rijksoverheid.nl/sitemap.xml
// zelf een sitemap-index is die, naast news/sitemap.xml en
// videos/sitemap.xml, verwijst naar een reeks genummerde, algemene
// sub-sitemaps (/sitemap/1.xml, /sitemap/2.xml, ...) zónder die 2-dagen-
// grens: bevestigd met content tot enkele jaren terug én de actuele dag
// (bijv. een artikel van dezelfde dag over de Zelfstandigenwet, relevant
// voor zzp'ers). Dit is dezelfde discovery-aanpak als de KVK-bron
// (sitemap_index.xml -> documents-*.xml) hieronder: een bredere, officiële,
// machineleesbare bron i.p.v. een kleinere. articleUrlPattern filtert deze
// (grotendeels niet-nieuws) algemene sub-sitemaps terug tot alleen
// /actueel/nieuws/-artikelen. De bestaande relevantiefilter
// (requireKeywordMatch/categoryKeywords/ministryBypass) is volledig
// ongewijzigd: er stromen alleen meer kandidaten dezelfde, bestaande
// filter in.
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
// Staat bewust vóór `sources` hieronder: de rijksoverheid-nieuws-bron
// verwijst naar rijksoverheidAudienceSignals (zie verderop) in haar eigen
// configuratie-object, en dat moet al geïnitialiseerd zijn op het moment
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
// alleen rijksoverheid-nieuws; andere bronnen filteren nog steeds
// uitsluitend op categoryKeywords (+ ministryBypass waar van toepassing).
export const rijksoverheidAudienceSignals = audienceKeywords.zzp;

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
    // Sitemap-index i.p.v. één Google News-sitemap (zie toelichting
    // hierboven) — bredere discovery, zelfde discovery-aanpak als KVK.
    sitemapIndexUrl: 'https://www.rijksoverheid.nl/sitemap.xml',
    articleUrlPattern: '/actueel/nieuws/',
    defaultCategory: 'Fiscale actualiteit',
    // Uitgeschakeld (legacy): vervangen door de gerichte topic-API-bron
    // hieronder. De eerste productierun met beide bronnen (2026-10-06)
    // leverde via deze sitewide sitemap 0 relevante artikelen op uit 100
    // beoordeelde pagina's; de bestaande content van deze bron is
    // verwijderd. Configuratie bewust bewaard (niet verwijderd) omdat
    // rijksoverheidAudienceSignals en de toelichting hierboven nog door de
    // topic-API-bron worden gebruikt.
    enabled: false,
    urlConfidence: 'confirmed',
    // Sitewide nieuws-discovery van de hele Rijksoverheid (alle ministeries):
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
    // Smalle, expliciete aanvulling op categoryKeywords — zie
    // rijksoverheidAudienceSignals hierboven voor de volledige toelichting.
    audienceSignals: rijksoverheidAudienceSignals,
    // 'prinsjesdag' is op zichzelf te breed voor sitewide Rijksoverheid-
    // nieuws (zie processSitemapSource in fetch-articles.mjs voor de
    // volledige toelichting en de audit die dit aantoonde, 2026-10-01):
    // elk ministerie publiceert rond Prinsjesdag nieuws, los van fiscale
    // relevantie. Trefwoorden in deze lijst tellen daarom alleen mee als
    // er ook een ander category- of audiencesignaal aanwezig is;
    // 'belastingplan' staat hier bewust niet in en blijft zelfstandig
    // voldoende.
    corroborationRequiredKeywords: ['prinsjesdag'],
  },
  {
    id: 'rijksoverheid-topic-api',
    name: 'Rijksoverheid (fiscale topics)',
    type: 'rijksoverheid-topic-api',
    // Aanvullende discovery-bron náást (niet in plaats van) de algemene
    // sitemap hierboven. Toegevoegd na read-only onderzoek (zie
    // git-historie) dat de daadwerkelijk werkende Rijksoverheid topic-API
    // (POST /api/search) en de exacte requestState/queryConfig-structuur
    // bevestigde via een live gecapturede browser-request. Bewust beperkt
    // tot deze 4 topics — de enige 4 die uit dat onderzoek naar voren kwamen
    // als zowel voldoende volume als hoge precision (geen van de overige
    // onderzochte topics, zoals Bbz/Europese subsidies/Prinsjesdag/zzp/
    // Buitenlandse werknemers/Ondernemen en innovatie, is hier toegevoegd).
    // Exacte topicnamen zoals de API ze verwacht, niet gegokt.
    topics: [
      'Belasting betalen',
      'Inkomstenbelasting',
      'Belastingverdragen',
      'Aanpak belastingontwijking en belastingontduiking',
    ],
    defaultCategory: 'Fiscale actualiteit',
    enabled: true,
    urlConfidence: 'confirmed',
    // Dezelfde relevantiepoort als de algemene Rijksoverheid-sitemapbron
    // hierboven, ongewijzigd hergebruikt: een topic-kandidaat is geen
    // automatische publicatie, en moet nog steeds door exact dezelfde
    // categoryKeywords-/ministryBypass-/audienceSignals-/corroboratie-
    // logica (zie processSitemapSource in fetch-articles.mjs).
    requireKeywordMatch: true,
    ministryBypass: 'Ministerie van Financiën',
    audienceSignals: rijksoverheidAudienceSignals,
    corroborationRequiredKeywords: ['prinsjesdag'],
    // Eigen, conservatieve discovery-grenzen voor de topic-API — los van
    // (en zonder wijziging aan) de bestaande RIJKSOVERHEID_MAX_PAGE_FETCHES_PER_RUN
    // in fetch-articles.mjs. 5 pagina's × 10 resultaten = maximaal 50
    // kandidaten per topic bevraagd; maxArticlesPerTopicPerRun begrenst
    // daarna hoeveel kandidaten per topic daadwerkelijk worden meegenomen,
    // ruim boven het werkelijk geobserveerde volume per topic (8–29) uit
    // het onderzoek.
    maxPagesPerTopic: 5,
    maxArticlesPerTopicPerRun: 20,
  },
  {
    id: 'mkb-nederland-nieuws',
    name: 'MKB-Nederland',
    type: 'rss',
    feedUrl: 'https://www.mkb.nl/rss/nieuws-mkb-nederland',
    defaultCategory: 'Fiscale actualiteit',
    // Uitgeschakeld (legacy): bron niet langer gewenst voor het
    // Kenniscentrum; de bestaande content van deze bron is verwijderd.
    enabled: false,
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
