/**
 * Serialiseert een object naar JSON die veilig is om in een
 * <script type="application/ld+json"> te plaatsen. JSON.stringify escaped
 * geen "<", waardoor een "</script>" ergens in de data (bv. een titel uit
 * externe content) de scripttag voortijdig zou kunnen afsluiten. Dit
 * vervangt "<" door de unicode-escape, wat in JSON geldig en in HTML inert
 * is.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
