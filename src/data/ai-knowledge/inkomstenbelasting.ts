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
      'Kosten die uitsluitend of overwegend zakelijk zijn, verlagen doorgaans de fiscale winst waarover u inkomsten- of vennootschapsbelasting betaalt; puur privékosten (zoals boodschappen) zijn niet aftrekbaar. Bij gemengde kosten (bijvoorbeeld een auto, telefoon of werkruimte thuis) is doorgaans alleen het zakelijke deel aftrekbaar, met eigen regels om dat deel te bepalen. Let op: dit gaat over de aftrekbaarheid voor de winstberekening — of over dezelfde kosten ook btw kan worden teruggevraagd, is een aparte beoordeling (zie het kennisitem "Btw bij zakelijke kosten en diensten"). Houd zakelijke en privé-uitgaven daarom gescheiden in de administratie.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/winst_uit_onderneming',
    lastVerified: '2026-09-29',
    tags: [
      'zakelijke kosten',
      'privékosten',
      'aftrekbare kosten',
      'welke kosten aftrekbaar',
      'privételefoon aftrekken',
      'gemengde kosten',
      'boodschappen aftrekken',
      'privéboodschappen',
    ],
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
    id: 'priveonttrekkingen-eenmanszaak',
    title: 'Privéonttrekkingen bij een eenmanszaak',
    category: 'Inkomstenbelasting',
    content:
      'Een privéonttrekking is geld, goederen of ander vermogen dat u als eigenaar van een eenmanszaak, VOF of maatschap aan de onderneming onttrekt voor privégebruik — bijvoorbeeld door zakelijk geld over te maken naar uw privérekening. Dit is iets anders dan loon (een eenmanszaak-eigenaar krijgt geen loon van de eigen zaak) en iets anders dan winst: een privéonttrekking is geen kostenpost en telt niet mee bij het bepalen van de fiscale winst waarover u inkomstenbelasting betaalt — die winst wordt bepaald ongeacht hoeveel u daadwerkelijk aan uzelf onttrekt. Onttrekkingen verminderen wel het ondernemingsvermogen en dus de liquiditeit van de zaak, en horen als zodanig in de administratie te worden vastgelegd, samen met eventuele privéstortingen (geld dat u juist vanuit privé in de zaak inbrengt). Bij een BV is de vergelijkbare situatie anders geregeld, via loon, dividend of een rekening-courant met de BV.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/privestortingen_en_priveonttrekkingen',
    lastVerified: '2026-09-29',
    tags: ['privéonttrekking', 'priveonttrekking', 'privéopname', 'priveopname', 'geld uit de zaak halen eenmanszaak', 'privéstorting', 'privestorting'],
    priority: 2,
  },
  {
    id: 'investeringsaftrek-kia',
    title: 'Investeringsaftrek (kleinschaligheidsinvesteringsaftrek)',
    category: 'Inkomstenbelasting',
    content:
      'De kleinschaligheidsinvesteringsaftrek (KIA) is een extra aftrekpost boven op de gewone afschrijving: als u in een jaar voor een bepaald totaalbedrag investeert in bedrijfsmiddelen (zoals machines, computers of bedrijfsauto\'s, met een minimumbedrag per bedrijfsmiddel), mag u een deel van dat investeringsbedrag aanvullend van de fiscale winst aftrekken. De KIA geldt alleen binnen een bepaalde bandbreedte van het totale jaarlijkse investeringsbedrag — bij een te laag of juist te hoog totaalbedrag vervalt de aftrek geheel of gedeeltelijk — en voor bepaalde bedrijfsmiddelen (zoals personenauto\'s voor privégebruik of grond) gelden uitzonderingen. De KIA wordt automatisch meegenomen via de aangifte inkomsten- of vennootschapsbelasting; een aparte aanvraag is niet nodig. De actuele bandbreedtes, percentages en uitgesloten bedrijfsmiddelen staan bij de Belastingdienst, omdat deze jaarlijks kunnen wijzigen.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/investeringsaftrek_en_desinvesteringsbijtelling/kleinschaligheidsinvesteringsaftrek_kia',
    lastVerified: '2026-09-29',
    tags: ['investeringsaftrek', 'kia', 'kleinschaligheidsinvesteringsaftrek', 'aftrek voor investering', 'extra aftrek investering'],
    priority: 2,
  },
  {
    id: 'afschrijving-bedrijfsmiddelen',
    title: 'Afschrijven van bedrijfsmiddelen',
    category: 'Inkomstenbelasting',
    content:
      'Bedrijfsmiddelen die langer dan een jaar meegaan — zoals machines, inventaris, een laptop of een bedrijfsauto — mag u voor de fiscale winstberekening meestal niet in één keer volledig als kosten aftrekken. In plaats daarvan schrijft u de aanschafkosten (verminderd met een eventuele restwaarde) over meerdere jaren af: elk jaar neemt u een deel van de kosten mee als afschrijving, verspreid over de verwachte gebruiksduur. Voor bedrijfsmiddelen onder een bepaald aanschafbedrag geldt een uitzondering: die mag u in het jaar van aanschaf direct volledig aftrekken. Startende ondernemers mogen onder voorwaarden willekeurig afschrijven (dus zelf bepalen wanneer en hoeveel), wat in de beginjaren voordelig kan zijn. Afschrijving staat los van de kleinschaligheidsinvesteringsaftrek (KIA): dat is een aanvullende, eenmalige aftrekpost bovenop de gewone afschrijving. De precieze drempelbedragen en maximale afschrijvingspercentages staan bij de Belastingdienst.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/inkomstenbelasting/inkomstenbelasting_voor_ondernemers/afschrijving/wat_is_afschrijven',
    lastVerified: '2026-09-29',
    tags: ['afschrijven', 'afschrijving', 'bedrijfsmiddel afschrijven', 'laptop aftrekken', 'ineens aftrekken', 'willekeurig afschrijven'],
    priority: 2,
  },
  {
    id: 'auto-van-de-zaak-bijtelling',
    title: 'Auto van de zaak en bijtelling',
    category: 'Inkomstenbelasting',
    content:
      'Wordt een zakelijke auto (van een BV, of een auto die als bedrijfsmiddel bij een eenmanszaak hoort) ook voor privéritten gebruikt, dan geldt een fiscale correctie voor dat privévoordeel: de bijtelling. Bij een auto van de BV die aan een DGA of werknemer ter beschikking wordt gesteld, telt de bijtelling mee als loon waarover loonheffing verschuldigd is; bij een auto die tot het ondernemingsvermogen van een eenmanszaak behoort, verhoogt een vergelijkbare correctie de fiscale winst. Wie aantoonbaar niet méér dan een beperkt aantal kilometers per jaar privé rijdt (bijvoorbeeld via een sluitende kilometeradministratie), kan bijtelling voorkomen — de exacte grens staat bij de Belastingdienst. De hoogte van het bijtellingspercentage hangt onder meer af van het type auto (waaronder CO2-uitstoot) en de cataloguswaarde, en wijzigt regelmatig. Naast de bijtelling voor de inkomsten-/loonbelasting geldt voor het privégebruik van een zakelijke auto ook een aparte btw-correctie.',
    targetAudience: ['zzp', 'mkb-ondernemer', 'bv-dga', 'werkgever'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/ondernemers/content/auto-van-de-zaak',
    lastVerified: '2026-09-29',
    tags: ['bijtelling', 'auto van de zaak', 'privégebruik auto', 'zakelijke auto privé', 'bijtelling berekenen'],
    priority: 2,
  },
  {
    id: 'werkruimte-thuis-aftrek',
    title: 'Werkruimte thuis aftrekken',
    category: 'Inkomstenbelasting',
    content:
      'Kosten voor een werkruimte in uw eigen woning zijn voor de fiscale winstberekening meestal niet aftrekbaar, ook niet als u er daadwerkelijk voor uw onderneming werkt. Aftrek is alleen mogelijk als de werkruimte voldoende zelfstandig is — bijvoorbeeld met een eigen opgang en eigen sanitair, zodat de ruimte ook apart aan een derde verhuurd zou kunnen worden — én u een substantieel deel van uw inkomen in die werkruimte verdient. Voldoet uw werkruimte niet aan deze voorwaarden (de meest voorkomende situatie bij een kamer of hoek in een gewone woning), dan zijn de woonlasten voor die ruimte niet aftrekbaar, maar blijven zuiver zakelijke aanschaffingen zoals een laptop, bureau of software daar los van gewoon aftrekbaar. De btw op de inrichting van een werkruimte kan overigens, ongeacht deze zelfstandigheidstoets, onder voorwaarden wel gedeeltelijk worden teruggevraagd. Raadpleeg de Belastingdienst voor de precieze voorwaarden en een rekentool.',
    targetAudience: ['zzp', 'mkb-ondernemer'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/ondernemers/content/zijn-kosten-voor-de-werkruimte-in-mijn-woning-aftrekbaar',
    lastVerified: '2026-09-29',
    tags: [
      'werkruimte thuis',
      'werkkamer aftrekken',
      'thuiswerkplek aftrekken',
      'kantoor aan huis',
      'werkruimte aftrekbaar',
      'ik werk vanuit een kamer thuis',
      'thuiswerkplek kosten opvoeren',
    ],
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
