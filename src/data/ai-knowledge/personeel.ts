import type { KnowledgeItem } from './types';

export const personeelItems: KnowledgeItem[] = [
  {
    id: 'werknemer-aannemen',
    title: 'Een werknemer aannemen',
    category: 'Personeel',
    content:
      'Zodra een onderneming voor het eerst personeel in dienst neemt, moet de ondernemer zich bij de Belastingdienst aanmelden als werkgever, uiterlijk op de dag dat de eerste werknemer begint. Na aanmelding ontvangt de werkgever de gegevens die nodig zijn om loonaangifte te kunnen doen. Ook moet de identiteit van de werknemer worden vastgesteld en is een burgerservicenummer (BSN) nodig voor de loonadministratie.',
    targetAudience: ['werkgever', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/personeel-en-loon/content/aanmelden-als-werkgever',
    lastVerified: '2026-09-28',
    tags: ['werknemer aannemen', 'personeel aannemen', 'eerste werknemer', 'aanmelden als werkgever'],
    priority: 3,
  },
  {
    id: 'loonadministratie',
    title: 'Loonadministratie',
    category: 'Personeel',
    content:
      'Werkgevers zijn verplicht een loonadministratie bij te houden voor iedere werknemer. De gegevens uit de loonadministratie (zoals brutoloon, ingehouden loonheffingen en gewerkte uren) vormen de basis voor de periodieke loonaangifte bij de Belastingdienst en voor de loonstrook van de werknemer. Een correcte en actuele loonadministratie is essentieel, omdat fouten kunnen doorwerken in zowel de belastingaangifte als de rechten van de werknemer (bijvoorbeeld bij een uitkering).',
    targetAudience: ['werkgever', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/personeel-en-loon/personeel-en-loon',
    lastVerified: '2026-09-28',
    tags: ['loonadministratie', 'salarisadministratie', 'loonstrook'],
    priority: 2,
  },
  {
    id: 'loonheffingen',
    title: 'Loonheffingen',
    category: 'Personeel',
    content:
      'Loonheffingen is de verzamelnaam voor de loonbelasting/premie volksverzekeringen, premies werknemersverzekeringen en de inkomensafhankelijke bijdrage Zorgverzekeringswet die een werkgever inhoudt op het loon van een werknemer en afdraagt aan de Belastingdienst. Werkgevers moeten hierover periodiek (doorgaans per maand of per vier weken) loonaangifte doen. Bedrijven met een beperkt aantal werknemers kunnen hiervoor gebruikmaken van de aangiftesoftware van de Belastingdienst via Mijn Belastingdienst Zakelijk.',
    targetAudience: ['werkgever', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl: 'https://www.belastingdienst.nl/wps/wcm/connect/nl/personeel-en-loon/content/loonaangifte-aangifte-loonheffingen',
    lastVerified: '2026-09-28',
    tags: ['loonheffingen', 'loonaangifte', 'loonbelasting'],
    priority: 3,
  },
  {
    id: 'vakantiegeld',
    title: 'Vakantiegeld',
    category: 'Personeel',
    content:
      'Werknemers hebben wettelijk recht op vakantiegeld (ook wel vakantiebijslag), een percentage van het bruto jaarloon dat doorgaans jaarlijks wordt uitbetaald, bijvoorbeeld in mei of juni. Ook werknemers die ziek zijn of een uitkering ontvangen, behouden in beginsel recht op vakantiegeld. Cao- of arbeidsvoorwaarden kunnen aanvullende afspraken bevatten; het exacte percentage en de uitbetalingsregels staan bij de Rijksoverheid.',
    targetAudience: ['werkgever', 'mkb-ondernemer'],
    sourceName: 'Rijksoverheid',
    sourceUrl: 'https://www.rijksoverheid.nl/onderwerpen/vakantiedagen-en-vakantiegeld',
    lastVerified: '2026-09-28',
    tags: ['vakantiegeld', 'vakantiebijslag'],
    priority: 2,
  },
  {
    id: 'ziekte-van-werknemer',
    title: 'Ziekte van een werknemer',
    category: 'Personeel',
    content:
      'Als een werknemer ziek wordt, is de werkgever wettelijk verplicht het loon gedurende een bepaalde periode door te betalen, met een minimum dat afhankelijk is van het wettelijk minimumloon en het geldende percentage; cao-afspraken kunnen een hoger percentage voorschrijven. Daarnaast gelden verplichtingen rond re-integratie, zoals het samen met de werknemer (en eventueel een bedrijfsarts) opstellen van een plan van aanpak. De exacte percentages, termijnen en verplichtingen staan bij de Rijksoverheid en het UWV.',
    targetAudience: ['werkgever', 'mkb-ondernemer'],
    sourceName: 'Rijksoverheid',
    sourceUrl: 'https://www.rijksoverheid.nl/onderwerpen/ziekteverzuim-van-het-werk/vraag-en-antwoord/hoeveel-loon-krijg-ik-doorbetaald-als-ik-ziek-ben',
    lastVerified: '2026-09-28',
    tags: ['ziekte werknemer', 'ziek personeel', 'loondoorbetaling bij ziekte', 're-integratie'],
    priority: 2,
  },
  {
    id: 'werkgeversverplichtingen',
    title: 'Werkgeversverplichtingen',
    category: 'Personeel',
    content:
      'Zodra een onderneming personeel in dienst heeft, gelden diverse wettelijke verplichtingen: aanmelding als werkgever bij de Belastingdienst, het bijhouden van een loonadministratie en het doen van periodieke loonaangifte, het naleven van arbeidsvoorwaarden (zoals minimumloon en vakantiedagen), en verplichtingen bij ziekte van een werknemer. Welke aanvullende verplichtingen precies gelden, hangt mede af van de sector en een eventueel toepasselijke cao — Avydo kan helpen dit voor uw onderneming op orde te brengen.',
    targetAudience: ['werkgever', 'mkb-ondernemer', 'bv-dga'],
    sourceName: 'Belastingdienst',
    sourceUrl:
      'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/ondernemen/hulp_in_uw_onderneming/personeel_in_uw_onderneming/',
    lastVerified: '2026-09-28',
    tags: ['werkgeversverplichtingen', 'verplichtingen werkgever', 'personeel in dienst'],
    priority: 3,
  },
];
