export type Service = {
  slug: string;
  name: string;
  short: string;
  intro: string;
  items: string[];
};

export const services: Service[] = [
  {
    slug: 'accountancy',
    name: 'Accountancy',
    short: 'Op het gebied van accountancy verleent Avydo vele diensten. Naast het samenstellen van jaarrekeningen begeleidt Avydo u in diverse situaties rondom uw bedrijfsvoering.',
    intro: 'Net zoals bij vrijwel elk accountantskantoor is accountancy ook bij Avydo de meest verleende dienst. Klanten van Avydo krijgen een vast aanspreekpunt toebedeeld: een accountant/relatiebeheerder die uw bedrijfsvoering nadrukkelijk analyseert. Met een Register-Accountant (RA) en Accountant-Administratieconsulent (AA) waarborgt Avydo de kwaliteit van de dienstverlening.',
    items: [
      'Het samenstellen, beoordelen en controleren van uw jaarrekening',
      'Het opstellen van begrotingen en cijferopstellingen',
      'Het beschrijven en beoordelen van de opzet administratieve organisatie en interne controle',
      'De begeleiding bij uw bedrijfseconomische vraagstukken',
      'Het verzorgen van uw financiële administratie en de aangiften omzetbelasting',
      'De begeleiding bij overnames, fusies en samenwerkingen',
      'Het verzorgen van aandelenwaarderingen en het uitvoeren van due diligence opdrachten',
    ],
  },
  {
    slug: 'belastingadvies',
    name: 'Belastingadvies',
    short: 'Ook op het gebied van belastingadvies is Avydo uw partner. Zo verzorgt Avydo diverse uiteenlopende fiscale werkzaamheden.',
    intro: 'Huurt u Avydo in als fiscaal adviseur, dan heeft u één vast aanspreekpunt: een van onze fiscalisten-relatiebeheerders. Bij deze specialist krijgt u informatie over uw situatie en alle fiscale diensten die wij verlenen, zodat uw fiscale situatie overzichtelijk blijft en u snel toegang heeft tot actuele informatie.',
    items: [
      'Optimalisatie van inkomstenbelasting voor de ondernemer',
      'Optimalisatie van inkomsten- en vennootschapsbelasting voor de DGA',
      'Optimalisatie bij vermogensoverdracht en successieheffing',
      'Advisering betreffende omzet- en overdrachtsbelasting met betrekking tot onroerend goed',
      'Begeleiding van fiscale herstructureringen, overnames en fusies',
      'Het verzorgen van uiteenlopende contracten en overeenkomsten',
    ],
  },
  {
    slug: 'loonadministratie',
    name: 'Loonadministratie',
    short: 'Avydo heeft een breed aanbod in de dienst loonadministratie. Naast periodieke loonberekeningen adviseren wij u graag op het gebied van cao’s en meer.',
    intro: 'Werkt u met meerdere arbeidskrachten, dan wordt de loonadministratie al snel complex. Bij Avydo vindt u alle diensten en expertise onder één dak, zodat u zich volledig kunt richten op het aansturen van uw personeel en het ontwikkelen van uw bedrijf.',
    items: [
      'Loonadvisering in de meest ruime zin van het woord',
      'Loonberekeningen op periodieke basis',
      'Aangiften voor de loonbelasting',
      'Begeleiding bij aannames en ontslagprocedures',
      'Het opstellen van arbeidsovereenkomsten',
      'Informatieverstrekking ten behoeve van uitvoeringsinstellingen',
      'Begeleiding bij ziekteverzuim en arbo-wetgeving',
      'Optimalisatie op het gebied van loonsubsidies',
    ],
  },
];

export const additionalServices = {
  intro: 'Naast de drie basisdiensten levert Avydo aanvullende mogelijkheden, zodat u met al uw vragen op één plek terechtkunt.',
  items: [
    {
      title: 'Kenniscentrum',
      description: 'In ons kenniscentrum houden wij u op de hoogte van relevante ontwikkelingen, bijvoorbeeld nieuws van de Kamer van Koophandel of de Belastingdienst.',
      href: '/kenniscentrum',
      linkLabel: 'Naar het kenniscentrum',
    },
    {
      title: 'Secretariaat',
      description: 'Elke klant krijgt te maken met ons secretariaat. Onze ervaren medewerkers zorgen dat u met uw vraag snel bij de juiste persoon terechtkomt.',
      href: '/contact',
      linkLabel: 'Neem contact op',
    },
  ],
};
