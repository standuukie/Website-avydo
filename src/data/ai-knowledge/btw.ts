import type { KnowledgeItem } from './types';

export const btwItems: KnowledgeItem[] = [
  {
    id: 'btw-algemeen',
    title: 'Btw in Nederland',
    category: 'Btw',
    content:
      'Btw (omzetbelasting) is de belasting die ondernemers in rekening brengen over de verkoop van goederen en diensten, en die zij periodiek afdragen aan de Belastingdienst. Btw die de ondernemer zelf betaalt over zakelijke kosten en investeringen (voorbelasting) mag daarbij doorgaans worden afgetrokken. Btw geldt voor vrijwel alle ondernemers, met enkele uitzonderingen en bijzondere regelingen voor specifieke sectoren of kleine ondernemers (zoals de KOR).',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/btw',
    lastVerified: '2026-09-29',
    tags: ['btw', 'omzetbelasting', 'wat is btw'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'btw-voor-wie',
    title: 'Voor wie geldt de btw',
    category: 'Btw',
    content:
      'U bent ondernemer voor de btw als u zelfstandig en op regelmatige basis activiteiten verricht en daar inkomsten uit heeft. Dit btw-ondernemerschap staat los van de rechtsvorm en los van het ondernemerschap voor de inkomstenbelasting: ook een stichting of vereniging kan bijvoorbeeld btw-ondernemer zijn. Voor bepaalde sectoren (zoals landbouw) en voor kleine ondernemers gelden bijzondere regelingen.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/hoe_werkt_de_btw/voor_wie_geldt_de_btw/voor_wie_geldt_de_btw',
    lastVerified: '2026-09-28',
    tags: ['btw ondernemer', 'voor wie geldt btw', 'btw-plicht'],
    priority: 2,
  },
  {
    id: 'btw-tarieven',
    title: 'Btw-tarieven',
    category: 'Btw',
    content:
      'In Nederland gelden meerdere btw-tarieven, met een algemeen (hoog) tarief voor de meeste goederen en diensten en een verlaagd tarief voor bepaalde categorieën (zoals sommige voedingsmiddelen en diensten); voor leveringen naar het buitenland kan onder voorwaarden een nultarief gelden. Welk tarief van toepassing is, hangt af van het specifieke product of de dienst. Voor de actuele percentages en welke goederen/diensten onder welk tarief vallen, is de Belastingdienst de bron om te raadplegen, omdat tarieven en indelingen kunnen wijzigen.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_berekenen_aan_uw_klanten/btw_berekenen/btw_tarief/',
    lastVerified: '2026-09-28',
    tags: ['btw tarief', 'btw tarieven', 'hoog laag tarief', 'nultarief'],
    priority: 3,
  },
  {
    id: 'btw-aangifte',
    title: 'Btw-aangifte doen',
    category: 'Btw',
    content:
      'Btw-ondernemers moeten periodiek (per maand, kwartaal of jaar, afhankelijk van de situatie) aangifte doen bij de Belastingdienst. In de aangifte wordt de btw opgegeven die in rekening is gebracht aan klanten, en de btw die als voorbelasting is betaald over zakelijke kosten en investeringen; het verschil is het bedrag dat betaald moet worden (of, bij meer voorbelasting dan verschuldigde btw, wordt teruggekregen). Het aangiftetijdvak en de exacte uiterste data staan vermeld in Mijn Belastingdienst Zakelijk en op de site van de Belastingdienst.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aangifte_doen_en_betalen/',
    lastVerified: '2026-09-28',
    tags: ['btw-aangifte', 'btw aangeven', 'aangifte doen', 'wanneer btw aangifte'],
    priority: 3,
  },
  {
    id: 'btw-betalen',
    title: 'Btw betalen',
    category: 'Btw',
    content:
      'Na het indienen van de btw-aangifte moet het verschuldigde bedrag binnen de door de Belastingdienst gestelde termijn zijn bijgeschreven. Betaalt u te laat, dan kan de Belastingdienst een betalingsherinnering of naheffingsaanslag opleggen, eventueel met een boete en/of belastingrente. Raadpleeg de Belastingdienst voor de exacte betaaltermijn die bij uw aangiftetijdvak hoort en voor het juiste rekeningnummer en betalingskenmerk.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_aangifte_doen_en_betalen/btw_betalen/',
    lastVerified: '2026-09-28',
    tags: ['btw betalen', 'btw op tijd betalen', 'btw naheffing'],
    priority: 2,
  },
  {
    id: 'btw-terugvragen-voorbelasting',
    title: 'Btw terugvragen (voorbelasting)',
    category: 'Btw',
    content:
      'Btw die een ondernemer zelf betaalt over zakelijke kosten en investeringen (voorbelasting) mag in de btw-aangifte in mindering worden gebracht op de btw die aan klanten in rekening is gebracht — dat is het aftrekken/verrekenen van voorbelasting, en gebeurt bij vrijwel elke aangifte. Is er in een tijdvak per saldo meer voorbelasting dan verschuldigde btw (bijvoorbeeld bij een grote investering), dan betaalt de Belastingdienst dat verschil daadwerkelijk terug; dat is iets anders dan de aftrek zelf en komt minder vaak voor. Voor btw op kosten die deels privé worden gebruikt (bijvoorbeeld een auto) gelden bijzondere correctieregels.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/btw',
    lastVerified: '2026-09-29',
    tags: ['voorbelasting', 'btw terugvragen', 'btw terugkrijgen', 'btw aftrekken'],
    priority: 2,
  },
  {
    id: 'kor',
    title: 'Kleineondernemersregeling (KOR)',
    category: 'Btw',
    content:
      'De kleineondernemersregeling (KOR) is een vrijstelling van btw, bedoeld voor kleine ondernemers die in Nederland zijn gevestigd en onder een bepaalde jaaromzetgrens blijven; de actuele grens en voorwaarden staan bij de Belastingdienst en kunnen wijzigen, dus controleer die daar. Bij deelname brengt u geen btw in rekening aan klanten en hoeft u ook geen btw-aangifte meer te doen. Daar staat tegenover dat u dan ook géén btw op zakelijke kosten en investeringen kunt terugvragen (voorbelasting), en dat afmelden voor de KOR niet van vandaag op morgen kan: dit moet vooraf worden aangemeld en gaat pas in vanaf het begin van een aangiftetijdvak. De KOR gaat uitsluitend over btw en zegt niets over de inkomsten- of vennootschapsbelasting, die u gewoon blijft betalen over de winst. Of deelname voordelig is, verschilt per situatie: het kan nadelig zijn als u veel zakelijke investeringen doet (waarvan u dan geen btw terugkrijgt), en levert doorgaans geen prijsvoordeel op bij klanten die zelf btw-plichtige ondernemers zijn, omdat die de btw op een gewone factuur toch al hadden kunnen terugvragen. Avydo kan meedenken of de KOR in uw situatie voordelig is.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/hoe_werkt_de_btw/kleineondernemersregeling/wat-betekent-meedoen-met-de-kleineondernemersregeling/',
    lastVerified: '2026-09-28',
    tags: ['kor', 'kleineondernemersregeling', 'kleine ondernemersregeling', 'btw vrijstelling', 'kor voordelig'],
    priority: 3,
    deterministicFallback: true,
  },
  {
    id: 'factuurvereisten',
    title: 'Factuurvereisten',
    category: 'Btw',
    content:
      'Voor de btw-administratie moet een factuur aan een aantal verplichte gegevens voldoen, zoals het btw-identificatienummer van de leverancier, een doorlopend factuurnummer, een omschrijving van de geleverde goederen of diensten, de leverdatum en het bedrag exclusief btw met het toegepaste btw-tarief en -bedrag. Voor kleine bedragen en in specifieke situaties (zoals bij de KOR) gelden vereenvoudigde of afwijkende regels. Wie niet aan de gestelde factuureisen voldoet, loopt het risico dat de aftrek van voorbelasting door een afnemer of de eigen administratie wordt betwist.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/factuureisen/factuureisen',
    lastVerified: '2026-09-28',
    tags: ['factuurvereisten', 'factuureisen', 'factuur maken', 'verplichte gegevens factuur'],
    priority: 2,
  },
  {
    id: 'btw-zakelijke-kosten-en-diensten',
    title: 'Btw bij zakelijke kosten en diensten',
    category: 'Btw',
    content:
      'Let op: dit gaat specifiek over de btw op zakelijke kosten, niet over de vraag of een kostenpost meetelt in de fiscale winstberekening voor de inkomsten- of vennootschapsbelasting (zie het kennisitem "Zakelijke kosten versus privékosten") — dit zijn twee losstaande beoordelingen, die overigens vaak wel dezelfde uitkomst hebben. Over zakelijke kosten en aangeschafte diensten wordt in de regel btw in rekening gebracht, die als voorbelasting kan worden teruggevraagd voor zover de kosten daadwerkelijk zakelijk gebruikt worden; bij gemengd zakelijk/privé-gebruikte kosten (bijvoorbeeld een auto of telefoon) mag doorgaans alleen het zakelijke deel worden teruggevraagd, en gelden specifieke correctieregels. Bij diensten aan het buitenland (bijvoorbeeld aan een andere ondernemer binnen de EU) gelden vaak afwijkende regels, zoals de verleggingsregeling, waarbij de btw-heffing verschuift naar de afnemer. Deze gemengde en internationale situaties zijn vaak maatwerk — raadpleeg de Belastingdienst of Avydo bij twijfel over een specifieke kostenpost.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/hoe_werkt_de_btw/',
    lastVerified: '2026-09-28',
    tags: ['btw zakelijke kosten', 'btw diensten', 'btw verleggen', 'btw buitenland', 'gemengde kosten btw'],
    priority: 2,
  },
];
