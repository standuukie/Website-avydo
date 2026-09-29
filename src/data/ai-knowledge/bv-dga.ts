import type { KnowledgeItem } from './types';

export const bvDgaItems: KnowledgeItem[] = [
  {
    id: 'vennootschapsbelasting',
    title: 'Vennootschapsbelasting',
    category: 'BV en vennootschapsbelasting',
    content:
      'Een BV (en andere rechtspersonen zoals een NV) betaalt vennootschapsbelasting (vpb) over de fiscale winst. Dit is een aparte belasting op het niveau van de vennootschap, los van de inkomstenbelasting die de directeur-grootaandeelhouder (DGA) privé betaalt over zijn of haar loon en eventueel ontvangen dividend. De hoogte van het vpb-tarief en de tariefschijven kunnen jaarlijks wijzigen; raadpleeg de Belastingdienst voor de actuele percentages.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/ondernemen/onderneming_starten/rechtsvorm/besloten-vennootschap-bv',
    lastVerified: '2026-09-28',
    tags: ['vennootschapsbelasting', 'vpb', 'belasting bv'],
    priority: 3,
  },
  {
    id: 'dga',
    title: 'Directeur-grootaandeelhouder (DGA)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Een directeur-grootaandeelhouder (DGA) is iemand die zowel bestuurder is van een BV als (samen met eventuele partner) een aanmerkelijk belang in de aandelen houdt. Dit begrip is fiscaal belangrijk omdat een DGA, anders dan een gewone werknemer, invloed heeft op de eigen beloning uit de BV — en de Belastingdienst daarom aanvullende regels hanteert om te voorkomen dat daardoor onterecht geen of te weinig belaste inkomsten worden opgenomen. Een DGA ontvangt loon uit de BV en kan daarnaast, als daar aanleiding voor is (bijvoorbeeld voldoende winst en vrij uitkeerbaar vermogen), dividend ontvangen. Voor het loon gelden specifieke fiscale regels, waaronder de gebruikelijkloonregeling; voor dividend gelden eigen regels, waaronder dividendbelasting.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/aanmerkelijk_belang/loon_en_aanmerkelijk_belang/',
    lastVerified: '2026-09-28',
    tags: ['dga', 'directeur grootaandeelhouder'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'gebruikelijk-loon',
    title: 'Gebruikelijk loon',
    category: 'BV en vennootschapsbelasting',
    content:
      'De gebruikelijkloonregeling bepaalt, onder voorwaarden, welk loon een aanmerkelijkbelanghouder die werkzaamheden verricht voor zijn of haar BV daarvoor fiscaal in aanmerking moet nemen — dit loon is niet vrij te kiezen, ook niet door bewust te kiezen voor geen of een laag loon. De hoogte is het hoogste bedrag van drie toetsen: een wettelijk vastgesteld normbedrag, het loon van de meest vergelijkbare dienstbetrekking, of het loon van de meestverdienende werknemer binnen de BV. Dit normbedrag is nadrukkelijk iets anders dan het wettelijk minimumloon voor werknemers — het gaat om een aparte regeling met een eigen bedrag. Het actuele normbedrag en de rekenregels wijzigen regelmatig — raadpleeg de Belastingdienst voor de geldende cijfers, of bespreek uw specifieke situatie met Avydo.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/aanmerkelijk_belang/loon_en_aanmerkelijk_belang/',
    lastVerified: '2026-09-29',
    tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris', 'hoeveel loon dga', 'loon mezelf uitbetalen', 'dga loon bepalen'],
    priority: 3,
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content:
      'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders. Voor een DGA die werkzaamheden verricht voor zijn of haar BV kan de gebruikelijkloonregeling van toepassing zijn; dividend staat daar los van en kan, als de BV tot uitkering besluit en aan de wettelijke voorwaarden (waaronder voldoende eigen vermogen) wordt voldaan, aanvullend aan de aandeelhouder worden uitgekeerd. Over uitgekeerd dividend is de aandeelhouder belasting verschuldigd; de BV houdt hiervoor doorgaans dividendbelasting in als voorheffing.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/als_u_dividend_uitkeert/als_u_dividend_uitkeert',
    lastVerified: '2026-09-29',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'winst-in-de-bv',
    title: 'Winst in de BV laten (winst reserveren)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Winst die in de BV blijft (dus niet als dividend wordt uitgekeerd) telt mee in de winst waarover de BV vennootschapsbelasting betaalt. Zolang de BV geen dividend uitkeert, is er in beginsel nog geen dividendbelasting of inkomstenbelasting verschuldigd bij de aandeelhouder; het geld blijft binnen de onderneming, bijvoorbeeld voor investeringen of als buffer voor liquiditeit. Zodra de BV wel besluit dividend uit te keren — mits aan de wettelijke voorwaarden is voldaan — ontstaat die belastingplicht alsnog. Of een BV daardoor per saldo fiscaal voordeliger is dan bijvoorbeeld een eenmanszaak, hangt af van de concrete situatie.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/als_u_dividend_uitkeert/als_u_dividend_uitkeert',
    lastVerified: '2026-09-29',
    tags: ['winst in de bv laten', 'winst reserveren', 'winst in bv houden', 'winst niet uitkeren', 'winstreserve', 'geld in de bv laten zitten'],
    priority: 3,
  },
  {
    id: 'dividendbelasting',
    title: 'Dividendbelasting',
    category: 'BV en vennootschapsbelasting',
    content:
      'Wanneer een BV dividend uitkeert aan haar aandeelhouders, moet zij hierover dividendbelasting inhouden en afdragen aan de Belastingdienst. Deze ingehouden dividendbelasting is een voorheffing die de aandeelhouder onder voorwaarden kan verrekenen met de eigen inkomstenbelasting. Het geldende percentage en de precieze regels (bijvoorbeeld bij uitkering aan buitenlandse aandeelhouders) staan bij de Belastingdienst, omdat deze kunnen wijzigen.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/dividendbelasting',
    lastVerified: '2026-09-29',
    tags: ['dividendbelasting', 'belasting op dividend'],
    priority: 2,
  },
  {
    id: 'rekening-courant-dga',
    title: 'Geld lenen van (of aan) uw eigen BV',
    category: 'BV en vennootschapsbelasting',
    content:
      'Een DGA kan geld lenen van de eigen BV, bijvoorbeeld via een rekening-courantverhouding (een lopende, wederzijdse schuldverhouding) of een aparte leningsovereenkomst. Dit is uitdrukkelijk iets anders dan loon of dividend: een lening moet worden terugbetaald en is in beginsel geen belast inkomen, mits zakelijke voorwaarden gelden (waaronder een reële rente en aflossingsafspraken, vergelijkbaar met een lening bij een bank). Voor de optelsom van alle schulden van een aanmerkelijkbelanghouder aan de eigen BV (rekening-courant en overige leningen samen, met een uitzondering voor een deel van een eigenwoningschuld onder voorwaarden) geldt een wettelijke grens: het deel daarboven wordt fiscaal behandeld als een fictieve uitkering en belast in box 2, ook als er feitelijk niets is uitgekeerd. Bij overschrijding geldt een hersteltermijn om weer onder de grens te komen. De actuele grens en voorwaarden staan bij de Belastingdienst — dit is een onderwerp waarbij Avydo graag meedenkt, gezien de fiscale risico\'s.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/werk_en_inkomen/bijzondere_situaties/geld_lenen_van_uw_bv/excessief-lenen-van-bv-beperkt',
    lastVerified: '2026-09-29',
    tags: [
      'rekening-courant',
      'rekening courant dga',
      'lenen van eigen bv',
      'geld lenen van bv',
      'excessief lenen',
      'lening dga bv',
      'geld uit bv halen zonder dividend',
      'geld lenen bv',
      'leen geld van bv',
      'ik leen geld van mijn bv',
    ],
    priority: 2,
  },
  {
    id: 'aandeelhouderschap-bv',
    title: 'Aandeelhouderschap bij meerdere aandeelhouders',
    category: 'BV en vennootschapsbelasting',
    content:
      'Heeft een BV meerdere aandeelhouders, dan is vastleggen wie welk aandelenbelang houdt en hoe besluiten worden genomen essentieel. De statuten (opgesteld bij de notariële oprichtingsakte) regelen de basisverhoudingen, zoals het aantal aandelen en de bevoegdheden van bestuur en aandeelhoudersvergadering; daarnaast is een BV wettelijk verplicht een aandeelhoudersregister bij te houden met de namen en belangen van alle aandeelhouders. Voor praktische afspraken die niet in de statuten thuishoren — bijvoorbeeld over winstbestemming, wat er gebeurt als een aandeelhouder wil vertrekken of overlijdt, of hoe aandelen mogen worden overgedragen — wordt vaak aanvullend een aandeelhoudersovereenkomst opgesteld; dit is niet wettelijk verplicht en vergt geen notaris, maar wordt bij meerdere aandeelhouders sterk aangeraden om latere geschillen te voorkomen. Avydo en uw notaris kunnen samen meedenken over de juiste vastlegging.',
    targetAudience: ['bv-dga', 'mkb-ondernemer'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/wetten-en-regels/het-belang-van-het-aandeelhoudersregister/',
    lastVerified: '2026-09-29',
    tags: [
      'aandeelhouderschap',
      'aandeelhoudersovereenkomst',
      'meerdere aandeelhouders',
      'aandeelhoudersregister',
      'compagnon bv',
      'samen met iemand een bv starten',
      'afspraken aandeelhouders vastleggen',
    ],
    priority: 2,
  },
  {
    id: 'holdingstructuur',
    title: 'Holdingstructuur',
    category: 'BV en vennootschapsbelasting',
    content:
      'Een holdingstructuur bestaat uit twee (of meer) BV\'s: een holding-BV die aandelen houdt in een werkmaatschappij-BV, waarin de eigenlijke bedrijfsactiviteiten plaatsvinden. Winst die de werkmaatschappij maakt, kan onder voorwaarden belastingvrij worden doorgesluisd naar de holding (de deelnemingsvrijstelling), waar deze als buffer kan worden opgebouwd, gescheiden van de risico\'s van de operationele activiteiten — gaat de werkmaatschappij bijvoorbeeld failliet, dan blijft vermogen in de holding daar in beginsel buiten schot. Een holdingstructuur brengt wel extra oprichtings- en administratiekosten met zich mee (twee BV\'s, dus ook twee keer een jaarrekening en aangifte vennootschapsbelasting), en is niet in elke situatie zinvol — vooral bij een beperkte winst of een enkele, laagrisico-activiteit weegt dit vaak niet op tegen de baten. Of een holdingstructuur in uw situatie de moeite waard is, hangt af van de winst, risico\'s en toekomstplannen — Avydo kan dit voor u doorrekenen.',
    targetAudience: ['bv-dga'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/wetten-en-regels/de-holding-bv-uitgelegd/',
    lastVerified: '2026-09-29',
    tags: ['holding', 'holdingstructuur', 'holding bv', 'werkmaatschappij', 'holding oprichten', 'heeft een holding zin', 'deelnemingsvrijstelling'],
    priority: 2,
  },
  {
    id: 'aanmerkelijk-belang',
    title: 'Aanmerkelijk belang (box 2)',
    category: 'BV en vennootschapsbelasting',
    content:
      'Van een aanmerkelijk belang is sprake als u, eventueel samen met een fiscale partner, direct of indirect een minimumbelang houdt in de aandelen, winstbewijzen of stemrechten van een BV of NV — de precieze grens staat bij de Belastingdienst. Een DGA heeft per definitie een aanmerkelijk belang in de eigen BV. Inkomen uit een aanmerkelijk belang — zoals ontvangen dividend of winst bij verkoop van de aandelen — wordt belast in box 2 van de inkomstenbelasting, een aparte box naast box 1 (werk en woning) met een eigen tarief. Ook naaste familieleden (bijvoorbeeld een fiscale partner of, in bepaalde gevallen, kinderen) kunnen onder de aanmerkelijkbelangregels vallen als zij een deel van de aandelen houden. Zie voor het loon en dividend van een DGA specifiek de kennisitems over gebruikelijk loon en dividend.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/inkomstenbelasting/heffingskortingen_boxen_tarieven/boxen_en_tarieven/box_2/',
    lastVerified: '2026-09-29',
    tags: ['aanmerkelijk belang', 'box 2', 'box 2 belasting', 'wanneer aanmerkelijk belang', 'ab-houder', 'dga'],
    priority: 3,
  },
  {
    id: 'fiscale-gevolgen-bv',
    title: 'Fiscale gevolgen van werken via een BV',
    category: 'BV en vennootschapsbelasting',
    content:
      'Werken via een BV verandert de fiscale positie ingrijpend ten opzichte van een eenmanszaak: de BV betaalt zelf vennootschapsbelasting over de winst, en de DGA betaalt daarnaast inkomstenbelasting over het loon (op basis van de gebruikelijkloonregeling) en over eventueel dividend. Hierdoor kan er sprake zijn van een vorm van dubbele heffing (op vennootschaps- én op privéniveau) die bij een eenmanszaak niet speelt. Of een BV per saldo fiscaal voordeliger is dan een eenmanszaak hangt sterk af van de winsthoogte en persoonlijke situatie — dit is bij uitstek iets om met Avydo door te rekenen.',
    targetAudience: ['bv-dga', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/ondernemen/onderneming_starten/rechtsvorm/besloten-vennootschap-bv',
    lastVerified: '2026-09-28',
    tags: ['fiscale gevolgen bv', 'bv belasting', 'werken via bv'],
    priority: 2,
  },
];
