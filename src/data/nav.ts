export type NavChild = { label: string; href: string; description?: string };
export type NavItem = { label: string; href: string; children?: NavChild[] };

export const mainNav: NavItem[] = [
  { label: 'Home', href: '/' },
  {
    label: 'Diensten',
    href: '/diensten',
    children: [
      { label: 'Accountancy', href: '/diensten/accountancy', description: 'Jaarrekeningen, controle en bedrijfseconomisch advies' },
      { label: 'Belastingadvies', href: '/diensten/belastingadvies', description: 'Fiscale optimalisatie voor ondernemer en DGA' },
      { label: 'Loonadministratie', href: '/diensten/loonadministratie', description: 'Salarisverwerking, cao- en hr-advies' },
      { label: 'Aanvullende diensten', href: '/diensten/aanvullende-diensten', description: 'Kenniscentrum en secretariaat' },
    ],
  },
  {
    label: 'Over Avydo',
    href: '/over-ons',
    children: [
      { label: 'Visie & werkwijze', href: '/over-ons' },
      { label: 'Team', href: '/over-ons/team' },
      { label: 'Geschiedenis', href: '/over-ons/geschiedenis' },
      { label: 'Maatschappelijke betrokkenheid', href: '/over-ons/mvo' },
    ],
  },
  { label: 'Referenties', href: '/referenties' },
  { label: 'Kenniscentrum', href: '/kenniscentrum' },
  { label: 'Werken bij Avydo', href: '/werken-bij-avydo' },
  { label: 'Contact', href: '/contact' },
];

export const footerNav = [
  {
    heading: 'Diensten',
    links: [
      { label: 'Accountancy', href: '/diensten/accountancy' },
      { label: 'Belastingadvies', href: '/diensten/belastingadvies' },
      { label: 'Loonadministratie', href: '/diensten/loonadministratie' },
      { label: 'Aanvullende diensten', href: '/diensten/aanvullende-diensten' },
    ],
  },
  {
    heading: 'Over Avydo',
    links: [
      { label: 'Visie & werkwijze', href: '/over-ons' },
      { label: 'Team', href: '/over-ons/team' },
      { label: 'Geschiedenis', href: '/over-ons/geschiedenis' },
      { label: 'Maatschappelijke betrokkenheid', href: '/over-ons/mvo' },
      { label: 'Referenties', href: '/referenties' },
    ],
  },
  {
    heading: 'Organisatie',
    links: [
      { label: 'Kenniscentrum', href: '/kenniscentrum' },
      { label: 'Werken bij Avydo', href: '/werken-bij-avydo' },
      { label: 'Contact', href: '/contact' },
      { label: 'Privacyverklaring', href: '/privacy' },
    ],
  },
];
