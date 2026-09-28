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
      'Een directeur-grootaandeelhouder (DGA) is iemand die zowel bestuurder is van een BV als (samen met eventuele partner) een aanmerkelijk belang in de aandelen houdt. Een DGA heeft een bijzondere fiscale positie: er gelden specifieke regels voor het loon dat de DGA uit de eigen BV ontvangt (de gebruikelijkloonregeling) en voor inkomsten uit het aanmerkelijk belang, zoals dividend. Deze regels zijn bedoeld om te voorkomen dat een DGA ten onrechte geen of te weinig belaste inkomsten uit de eigen BV opneemt.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/aanmerkelijk_belang/loon_en_aanmerkelijk_belang/',
    lastVerified: '2026-09-28',
    tags: ['dga', 'directeur grootaandeelhouder', 'aanmerkelijk belang'],
    priority: 3,
  },
  {
    id: 'gebruikelijk-loon',
    title: 'Gebruikelijk loon',
    category: 'BV en vennootschapsbelasting',
    content:
      'De gebruikelijkloonregeling verplicht een DGA om zichzelf een loon toe te kennen dat gebruikelijk is voor het niveau en de duur van zijn of haar werkzaamheden voor de BV, ook als de DGA daar zelf voor zou kiezen geen of een laag loon op te nemen. De Belastingdienst toetst dit gebruikelijke loon onder meer aan het loon van vergelijkbare functies en aan het loon van de meestverdienende werknemer binnen de BV, met een wettelijk vastgesteld minimumbedrag. Het actuele minimumbedrag en de rekenregels wijzigen regelmatig — raadpleeg de Belastingdienst voor de geldende cijfers, of bespreek uw specifieke situatie met Avydo.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/aanmerkelijk_belang/loon_en_aanmerkelijk_belang/',
    lastVerified: '2026-09-28',
    tags: ['gebruikelijk loon', 'gebruikelijkloonregeling', 'dga salaris'],
    priority: 3,
  },
  {
    id: 'dividend',
    title: 'Dividend',
    category: 'BV en vennootschapsbelasting',
    content:
      'Dividend is een uitkering van (een deel van) de winst van een BV aan haar aandeelhouders, als alternatief voor (of aanvulling op) het uitkeren van loon aan een DGA. Een BV mag alleen dividend uitkeren als het eigen vermogen dit toelaat, en moet daarbij aan wettelijke waarborgen voldoen. Over uitgekeerd dividend is de aandeelhouder belasting verschuldigd; de BV houdt hiervoor doorgaans dividendbelasting in.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/als_u_dividend_uitkeert/als_u_dividend_uitkeert',
    lastVerified: '2026-09-28',
    tags: ['dividend', 'dividend uitkeren', 'winstuitkering'],
    priority: 2,
  },
  {
    id: 'dividendbelasting',
    title: 'Dividendbelasting',
    category: 'BV en vennootschapsbelasting',
    content:
      'Wanneer een BV dividend uitkeert aan haar aandeelhouders, moet zij hierover dividendbelasting inhouden en afdragen aan de Belastingdienst. Deze ingehouden dividendbelasting kan de aandeelhouder onder voorwaarden verrekenen met de eigen inkomstenbelasting. Het geldende percentage en de precieze regels (bijvoorbeeld bij uitkering aan buitenlandse aandeelhouders) staan bij de Belastingdienst, omdat deze kunnen wijzigen.',
    targetAudience: ['bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/dividendbelasting/dividendbelasting',
    lastVerified: '2026-09-28',
    tags: ['dividendbelasting', 'belasting op dividend'],
    priority: 2,
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
