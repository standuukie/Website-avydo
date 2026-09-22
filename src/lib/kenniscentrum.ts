const monthsShort = [
  'jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

export function formatDate(date: Date): string {
  return `${date.getDate()} ${monthsShort[date.getMonth()]} ${date.getFullYear()}`;
}
