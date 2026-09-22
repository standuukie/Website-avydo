export type Job = {
  title: string;
  type: string;
  intro: string;
  tasks: string[];
  contact: string;
};

export const jobs: Job[] = [
  {
    title: 'Belastingadviseur / relatiebeheerder',
    type: 'Fulltime, m/v',
    intro: 'Avydo is ook op het gebied van fiscaliteit altijd in ontwikkeling. Daarom zoeken we een enthousiaste en academisch geschoolde belastingadviseur/relatiebeheerder. Bij voorkeur heb je ook de FB- of NOB-opleiding doorlopen.',
    tasks: [
      'Advies geven en gemaakte belastingaangiften controleren',
      'Uitgevoerde opdrachten zelfstandig of samen met een directielid bespreken',
      'Mede verantwoordelijk zijn voor de aangiftepraktijk',
      'Als relatiebeheerder aanspreekpunt zijn voor de cliënt en onderbouwd adviseren over fiscale en ondernemersaspecten',
    ],
    contact: 'dhr. H.J.M.J. Verbaandert',
  },
  {
    title: 'Accountant-Administratieconsulent / Register-Accountant',
    type: 'Fulltime, m/v',
    intro: 'Avydo houdt altijd de ogen open voor kansen in de markt. Daarom zoeken we een enthousiaste en academisch geschoolde accountant/relatiebeheerder met (bijna) een AA/RA-diploma en ruime werkervaring als assistent-accountant en accountant.',
    tasks: [
      'Zorgdragen voor goede advisering en het aandragen van nieuwe klanten',
      'Coördinatie en samenstelling van jaarrekeningen en verwerking van fiscale aangiften',
      'Als relatiebeheerder aanspreekpunt zijn voor de cliënt',
      'Onderbouwd adviseren over de bedrijfsvoering, in constructief en vertrouwelijk contact met de cliënt',
    ],
    contact: 'dhr. H.W.J. Duijkers',
  },
];

export const applyAddress = {
  line1: 'Avydo Accountants & Belastingadviseurs',
  line2: 't.a.v. de directie',
  line3: 'Postbus 257',
  line4: '5800 AG Venray',
};

export const internships = {
  intro: 'Avydo werkt graag mee aan de ontwikkeling van talentvolle studenten. Ben jij een enthousiaste hbo-student op economisch en/of fiscaal gebied en denk je een meerwaarde te kunnen zijn voor Avydo? Stuur je stageopdracht en cv naar info@avydo.nl of per post naar Postbus 257, 5800 AG Venray, t.a.v. de directie.',
  partners: ['Fontys: CE-SPECO, Tilburg', 'Fontys: Fiscaal Recht en Economie, Eindhoven'],
};
