export type Testimonial = {
  name: string;
  quote: string;
  logo: string;
  logoWidth: number;
  logoHeight: number;
};

export const testimonials: Testimonial[] = [
  {
    name: 'Lely Center Venray',
    quote: 'Sinds de oprichting van Avydo werken wij met hen samen. Nooit hebben wij spijt gehad van onze keuze.',
    logo: '/images/references/lely.gif',
    logoWidth: 150,
    logoHeight: 100,
  },
  {
    name: 'Aandachttrekkers',
    quote: 'Voor ondernemers is Avydo een sterke combinatie van beheersing en advies. De informele sfeer maakt de samenwerking met Avydo erg prettig.',
    logo: '/images/references/aandachttrekkers.png',
    logoWidth: 447,
    logoHeight: 447,
  },
  {
    name: 'Reisbureau Vice Versa',
    quote: 'Met ervaring als zelfstandig ondernemer is Avydo mijn partner in bedrijfsvoering. Dankzij fiscaal advies van Avydo heb ik geld verdiend.',
    logo: '/images/references/vice-versa.png',
    logoWidth: 150,
    logoHeight: 124,
  },
];
