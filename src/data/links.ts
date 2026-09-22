export type ResourceLink = {
  name: string;
  url: string;
  description: string;
};

export const resourceLinks: ResourceLink[] = [
  {
    name: 'Kamer van Koophandel',
    url: 'https://www.kvk.nl',
    description: 'Inschrijvingen, ondernemersregels en actuele informatie voor ondernemers.',
  },
  {
    name: 'Belastingdienst',
    url: 'https://www.belastingdienst.nl',
    description: 'Officiële informatie over belastingaangiften, tarieven en regelingen.',
  },
  {
    name: 'MKB Nederland',
    url: 'https://www.mkb.nl',
    description: 'Belangenbehartiging en nieuws voor het midden- en kleinbedrijf.',
  },
  {
    name: 'NBA',
    url: 'https://www.nba.nl',
    description: 'De Koninklijke Nederlandse Beroepsorganisatie van Accountants.',
  },
  {
    name: 'Financieel Dagblad',
    url: 'https://www.fd.nl',
    description: 'Actueel financieel-economisch nieuws.',
  },
  {
    name: 'Ministerie van Financiën',
    url: 'https://www.rijksoverheid.nl/ministeries/ministerie-van-financien',
    description: 'Beleid en regelgeving op het gebied van belastingen en financiën.',
  },
  {
    name: 'Gemeente Venray',
    url: 'https://www.venray.nl',
    description: 'Informatie over ondernemen en vergunningen in de gemeente Venray.',
  },
];
