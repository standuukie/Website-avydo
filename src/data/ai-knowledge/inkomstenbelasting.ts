import type { KnowledgeItem } from './types';

export const inkomstenbelastingItems: KnowledgeItem[] = [
  {
    id: 'ib-voor-ondernemers',
    title: 'Inkomstenbelasting voor ondernemers',
    category: 'Inkomstenbelasting',
    content:
      'Ondernemers met een eenmanszaak, VOF of maatschap betalen inkomstenbelasting over de winst van de onderneming, als onderdeel van hun persoonlijke aangifte inkomstenbelasting (box 1, inkomen uit werk en woning). Dit is een belangrijk verschil met een BV, waar de vennootschap zelf vennootschapsbelasting betaalt en de directeur-grootaandeelhouder apart belasting betaalt over zijn of haar loon en eventuele dividend. Of u voor de inkomstenbelasting als ondernemer wordt aangemerkt, hangt af van een aantal criteria die de Belastingdienst hanteert.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/wanneer_bent_u_ondernemer_voor_de_inkomstenbelasting/',
    lastVerified: '2026-09-28',
    tags: ['inkomstenbelasting ondernemer', 'ib ondernemer', 'inkomstenbelasting zzp'],
    priority: 3,
  },
  {
    id: 'winst-uit-onderneming',
    title: 'Winst uit onderneming',
    category: 'Inkomstenbelasting',
    content:
      'Winst uit onderneming is het fiscale resultaat van de onderneming en vormt onderdeel van het box 1-inkomen van de ondernemer. De fiscale winst wordt berekend door op de commerciële winst- en verliesrekening en balans bepaalde fiscale regels toe te passen (bijvoorbeeld rond afschrijvingen en aftrekposten), en is dus niet automatisch hetzelfde bedrag als de winst die in de reguliere boekhouding wordt getoond.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/winst_uit_onderneming',
    lastVerified: '2026-09-28',
    tags: ['winst uit onderneming', 'fiscale winst', 'ondernemersinkomen'],
    priority: 2,
  },
  {
    id: 'zakelijke-versus-prive-kosten',
    title: 'Zakelijke kosten versus privékosten',
    category: 'Inkomstenbelasting',
    content:
      'Kosten die uitsluitend of overwegend zakelijk worden gemaakt, verlagen doorgaans de fiscale winst waarover u inkomsten- of vennootschapsbelasting betaalt; puur privékosten doen dat niet. Bij gemengde kosten (zowel zakelijk als privé gebruikt — een auto, een telefoon, of een werkruimte thuis zijn de bekendste voorbeelden) mag doorgaans alleen het zakelijke deel worden afgetrokken, en gelden vaak specifieke fiscale regels om dat deel te bepalen; een privételefoon die u af en toe zakelijk gebruikt is dus niet zonder meer volledig aftrekbaar. Let op: dit gaat over de aftrekbaarheid voor de winstberekening (inkomsten-/vennootschapsbelasting) — of over dezelfde kosten ook btw kan worden teruggevraagd, is een aparte beoordeling met eigen regels (zie het kennisitem "Btw bij zakelijke kosten en diensten"). Het is belangrijk zakelijke en privé-uitgaven goed gescheiden te administreren, omdat een onterecht als zakelijk geboekte kostenpost bij een controle kan worden gecorrigeerd.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/winst_uit_onderneming',
    lastVerified: '2026-09-28',
    tags: ['zakelijke kosten', 'privékosten', 'aftrekbare kosten', 'welke kosten aftrekbaar', 'privételefoon aftrekken', 'gemengde kosten'],
    priority: 3,
  },
  {
    id: 'voorlopige-aanslag',
    title: 'Voorlopige aanslag',
    category: 'Inkomstenbelasting',
    content:
      'Een voorlopige aanslag inkomstenbelasting is een schatting van de te betalen (of terug te krijgen) belasting over het lopende jaar, die maandelijks in termijnen kan worden betaald in plaats van in één keer na de definitieve aanslag. Voor ondernemers die winst maken kan het aanvragen van een voorlopige aanslag verstandig zijn om te voorkomen dat achteraf in één keer een groot bedrag moet worden bijbetaald (met mogelijk belastingrente). Een voorlopige aanslag kan gedurende het jaar worden aangevraagd of gewijzigd via Mijn Belastingdienst.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/nl/startende-ondernemer/content/startende-ondernemer-is-het-verstandig-een-voorlopige-aanslag-inkomstenbelasting-aan-te-vragen',
    lastVerified: '2026-09-28',
    tags: ['voorlopige aanslag', 'voorlopige aanslag aanvragen', 'belasting vooraf betalen'],
    priority: 2,
  },
  {
    id: 'ondernemersaftrek',
    title: 'Ondernemersaftrek',
    category: 'Inkomstenbelasting',
    content:
      'De ondernemersaftrek is een verzameling van aftrekposten voor ondernemers in de inkomstenbelasting, waaronder de zelfstandigenaftrek, de startersaftrek en de meewerkaftrek. Voor de meeste onderdelen van de ondernemersaftrek moet aan het urencriterium worden voldaan. De ondernemersaftrek vermindert de fiscale winst waarover inkomstenbelasting wordt geheven; de actuele bedragen en voorwaarden per onderdeel staan bij de Belastingdienst, omdat deze regelmatig wijzigen.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/ondernemersaftrek/ondernemersaftrek',
    lastVerified: '2026-09-28',
    tags: ['ondernemersaftrek', 'zelfstandigenaftrek', 'startersaftrek', 'meewerkaftrek'],
    priority: 2,
  },
  {
    id: 'urencriterium',
    title: 'Urencriterium',
    category: 'Inkomstenbelasting',
    content:
      'Het urencriterium is de voorwaarde dat een ondernemer een minimumaantal uren per jaar aan de onderneming moet besteden, en daarbij meer tijd aan de onderneming moet besteden dan aan eventuele andere werkzaamheden (zoals een dienstverband), om in aanmerking te komen voor het grootste deel van de ondernemersaftrek. Alle uren die daadwerkelijk aan de onderneming worden besteed tellen mee, niet alleen declarabele/factureerbare uren. De precieze normen en een eventuele verlaagde variant staan bij de Belastingdienst.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/voorwaarden_urencriterium',
    lastVerified: '2026-09-28',
    tags: ['urencriterium', 'aantal uren ondernemer', 'uren criterium'],
    priority: 2,
  },
  {
    id: 'fiscale-gevolgen-starten',
    title: 'Fiscale gevolgen van een onderneming starten',
    category: 'Inkomstenbelasting',
    content:
      'Vanaf het moment van starten krijgt een ondernemer te maken met meerdere belastingen tegelijk: doorgaans inkomstenbelasting (of vennootschapsbelasting bij een BV) over de winst, en meestal btw over de omzet. Ook kunnen er gevolgen zijn voor eventuele toeslagen en, bij een BV, voor loonheffing. Omdat deze regels op elkaar inwerken en per situatie verschillen, is het voor startende ondernemers verstandig om vooraf in kaart te brengen welke belastingen gaan gelden — Avydo kan hierbij ondersteunen.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'KVK',
    sourceUrl: 'https://www.kvk.nl/starten/alles-over-belastingen-voor-starters/',
    lastVerified: '2026-09-28',
    tags: ['fiscale gevolgen starten', 'belasting starten', 'belastingen startende ondernemer'],
    priority: 2,
  },
];
