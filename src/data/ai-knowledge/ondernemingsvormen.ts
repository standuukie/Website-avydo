import type { KnowledgeItem } from './types';

export const ondernemingsvormenItems: KnowledgeItem[] = [
  {
    id: 'onderneming-starten',
    title: 'Een onderneming starten',
    category: 'Ondernemingsvormen',
    content:
      'Wie in Nederland een onderneming start, moet zich inschrijven bij de Kamer van Koophandel (KVK) en krijgt daarna te maken met verplichtingen rond administratie en belastingen. Voor het starten is het belangrijk vooraf een rechtsvorm te kiezen (bijvoorbeeld eenmanszaak of BV) en te weten welke belastingen gaan gelden (zoals inkomstenbelasting of vennootschapsbelasting, en meestal btw).',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'KVK',
    sourceUrl: 'https://ondernemersplein.kvk.nl/bedrijf-starten/voorbereiden/eigen-bedrijf-starten-10-belangrijke-stappen',
    lastVerified: '2026-09-28',
    tags: ['onderneming starten', 'starten', 'startende ondernemer', 'bedrijf beginnen'],
    priority: 3,
  },
  {
    id: 'kvk-inschrijving',
    title: 'Inschrijving bij de KVK',
    category: 'Ondernemingsvormen',
    content:
      'Iedere onderneming en rechtspersoon in Nederland moet worden ingeschreven in het Handelsregister van de Kamer van Koophandel (KVK) — dit geldt voor zelfstandigen, zzp\'ers, eenmanszaken en rechtspersonen zoals de BV. Na inschrijving krijgt de onderneming een KVK-nummer en worden de gegevens automatisch doorgegeven aan de Belastingdienst, die vervolgens bepaalt welke belastingplicht(en) gaan gelden.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'KVK',
    sourceUrl: 'https://ondernemersplein.kvk.nl/wetten-en-regels/bedrijf-starten-of-overnemen',
    lastVerified: '2026-09-28',
    tags: ['kvk', 'inschrijving', 'handelsregister', 'kvk-nummer', 'inschrijven'],
    priority: 3,
  },
  {
    id: 'rechtsvorm-kiezen',
    title: 'Een rechtsvorm kiezen',
    category: 'Ondernemingsvormen',
    content:
      'De keuze voor een rechtsvorm (zoals eenmanszaak, VOF, maatschap of BV) bepaalt onder meer wie aansprakelijk is voor schulden, hoeveel administratieve verplichtingen er gelden en hoe de winst wordt belast. Er is geen rechtsvorm die voor iedereen het beste is: de juiste keuze hangt af van factoren als verwachte winst, risico\'s, of er wordt samengewerkt met anderen, en persoonlijke wensen rond aansprakelijkheid. Avydo kan helpen deze afweging voor uw eigen situatie te maken.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/starten/een-eenmanszaak-of-bv-als-rechtsvorm-kiezen/',
    lastVerified: '2026-09-28',
    tags: ['rechtsvorm', 'rechtsvorm kiezen', 'welke rechtsvorm', 'ondernemingsvorm'],
    priority: 3,
  },
  {
    id: 'eenmanszaak',
    title: 'Eenmanszaak',
    category: 'Ondernemingsvormen',
    content:
      'Een eenmanszaak is een rechtsvorm zonder rechtspersoonlijkheid: er is geen juridisch onderscheid tussen de onderneming en de eigenaar in privé, waardoor de ondernemer met zijn of haar privévermogen aansprakelijk is voor zakelijke schulden. Een eenmanszaak kan maar één eigenaar hebben en wordt vaak gekozen vanwege de eenvoudige oprichting (inschrijving bij de KVK) en beperkte administratieve verplichtingen ten opzichte van een BV.',
    targetAudience: ['zzp'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/starten/een-eenmanszaak-of-bv-als-rechtsvorm-kiezen/',
    lastVerified: '2026-09-28',
    tags: ['eenmanszaak', 'zzp', 'zelfstandig ondernemer'],
    priority: 2,
  },
  {
    id: 'bv',
    title: 'Besloten vennootschap (BV)',
    category: 'Ondernemingsvormen',
    content:
      'Een besloten vennootschap (BV) is een rechtspersoon: de BV heeft eigen rechten en plichten, los van de persoon (of personen) die de BV bestuurt of erin werkt. Voor oprichting is een notariële akte nodig. Omdat de BV een aparte rechtspersoon is, is doorgaans niet de bestuurder/aandeelhouder in privé aansprakelijk voor schulden van de BV, maar de BV zelf (met uitzonderingen bij bijvoorbeeld wanbestuur). Een BV betaalt vennootschapsbelasting over de winst, in plaats van dat de winst rechtstreeks bij de eigenaar in de inkomstenbelasting valt zoals bij een eenmanszaak.',
    targetAudience: ['bv-dga', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/ondernemen/onderneming_starten/rechtsvorm/besloten-vennootschap-bv',
    lastVerified: '2026-09-28',
    tags: ['bv', 'besloten vennootschap', 'rechtspersoon'],
    priority: 2,
  },
  {
    id: 'vof-en-maatschap',
    title: 'VOF en maatschap',
    category: 'Ondernemingsvormen',
    content:
      'De vennootschap onder firma (VOF) en de maatschap zijn rechtsvormen voor het samen ondernemen met een of meer anderen, zonder rechtspersoonlijkheid. Bij een VOF wordt gezamenlijk een bedrijf uitgeoefend en zijn de vennoten (deels hoofdelijk) aansprakelijk voor de schulden van de VOF; een maatschap wordt vooral gebruikt door samenwerkende beroepsbeoefenaren (bijvoorbeeld maatschappen van zelfstandige adviseurs), waarbij de maten in beginsel voor gelijke delen aansprakelijk zijn. Welke vorm het beste past hangt af van de aard van de samenwerking.',
    targetAudience: ['mkb-ondernemer', 'zzp'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/starten/beste-rechtsvorm-voor-samenwerking/',
    lastVerified: '2026-09-28',
    tags: ['vof', 'vennootschap onder firma', 'maatschap', 'samenwerken', 'samen een bedrijf starten'],
    priority: 2,
  },
  {
    id: 'verschil-eenmanszaak-en-bv',
    title: 'Verschil tussen een eenmanszaak en een BV',
    category: 'Ondernemingsvormen',
    content:
      'Het belangrijkste verschil is rechtspersoonlijkheid: een BV is een rechtspersoon met een eigen vermogen, een eenmanszaak niet. Dat werkt door in de aansprakelijkheid (bij een eenmanszaak is de ondernemer in privé aansprakelijk, bij een BV in beginsel de BV zelf), in de belastingheffing (een eenmanszaak valt onder de inkomstenbelasting, een BV onder de vennootschapsbelasting, met loonheffing over het loon van de directeur-grootaandeelhouder) en in de administratieve verplichtingen (een BV moet onder meer een jaarrekening deponeren). Welke rechtsvorm in een concrete situatie fiscaal en juridisch het beste past, hangt af van onder meer de verwachte winst, risico\'s en persoonlijke voorkeuren — Avydo kan dit voor uw situatie doorrekenen.',
    targetAudience: ['zzp', 'bv-dga', 'mkb-ondernemer'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/starten/een-eenmanszaak-of-bv-als-rechtsvorm-kiezen/',
    lastVerified: '2026-09-28',
    tags: ['verschil eenmanszaak bv', 'eenmanszaak of bv', 'eenmanszaak versus bv'],
    priority: 3,
  },
];
