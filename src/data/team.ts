export type TeamMember = {
  name: string;
  role: string;
  photo: string;
  bio: string[];
};

export const partners: TeamMember[] = [
  {
    name: 'Eric Verbaandert',
    role: 'Partner & fiscaal adviseur',
    photo: '/images/team/eric-verbaandert.jpg',
    bio: [
      'Eric Verbaandert is ongeveer 32 jaar werkzaam als fiscaal adviseur in de MKB-sector. In het verleden is hij onder meer vennoot geweest van een tweetal vergelijkbare accountantskantoren.',
      'Voornamelijk op grond van opleiding en ervaring is hij gespecialiseerd in het combineren van fiscale met bedrijfseconomische advisering. Met hart voor zijn klanten adviseert hij bedrijven en particulieren op het fiscale terrein in brede zin.',
    ],
  },
  {
    name: 'René Duijkers',
    role: 'Partner & accountant',
    photo: '/images/team/rene-duijkers.jpg',
    bio: [
      'René Duijkers is ongeveer 28 jaar werkzaam als adviseur en accountant voor MKB-ondernemers. Naast de bekende diensten heeft hij als adviseur/accountant veel ervaring opgedaan op het gebied van fiscale advisering, due diligence en uiteenlopende bedrijfseconomische advisering.',
      'Een belangrijke specialisatie is het begeleiden van de MKB-ondernemer in diens persoonlijke groei. Daarnaast fungeert hij als ‘sparringpartner’ voor ondernemers bij fiscale optimalisering, strategiebepaling, het stellen van doelen en het meten van resultaten.',
    ],
  },
];

export const teamIntro = 'Avydo hecht veel waarde aan het werken in teamverband. Het team bestaat uit 10 sterke krachten, verdeeld over diverse afdelingen. Door de nauwe samenwerking profiteren onze professionals van elkaars expertise, zodat Avydo u optimaal van dienst kan zijn.';
