export type Sponsorship = {
  name: string;
  description: string;
  website: string;
  logo: string;
  logoWidth: number;
  logoHeight: number;
};

export const sponsorships: Sponsorship[] = [
  {
    name: 'SV Venray',
    description: 'SV Venray is de grootste voetbalvereniging van Venray. Het eerste elftal is actief in de Hoofdklasse B van de zondagamateurs. Avydo heeft oog voor de toekomst en is sponsor van de mini F’jes, die zijn voorzien van shirts van grote voetbalclubs.',
    website: 'https://www.svvenray.nl',
    logo: '/images/sponsors/sv-venray.jpg',
    logoWidth: 200,
    logoHeight: 200,
  },
  {
    name: 'RKVV Volharding',
    description: 'RKVV Volharding is een voetbalvereniging uit Vierlingsbeek met ruim 400 actieve leden, opgericht in 1914. Het eerste elftal speelt in de tweede klasse. Avydo is sponsor van het scorebord van het hoofdveld.',
    website: 'https://www.rkvv-volharding.com',
    logo: '/images/sponsors/rkvv-volharding.jpg',
    logoWidth: 447,
    logoHeight: 447,
  },
  {
    name: 'Mixed Hockey Club Venray',
    description: 'Mixed Hockey Club Venray is de hockeyclub van Venray, met een rijke historie. Met twee kampioenschappen op rij is Avydo trotse shirtsponsor van het eerste herenelftal.',
    website: 'https://www.mhcv.nl',
    logo: '/images/sponsors/mhcv.png',
    logoWidth: 447,
    logoHeight: 447,
  },
];

export const mvoIntro = 'Avydo hecht veel waarde aan het plezier en succes binnen Venray en geeft op diverse manieren invulling aan maatschappelijk verantwoord ondernemen, onder meer via sponsoring en door de ontwikkeling van studenten aan te moedigen.';
