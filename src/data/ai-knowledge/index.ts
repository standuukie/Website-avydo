// Avydo AI-kennisbank: een statische, versiebeheerde verzameling
// algemene, controleerbare kennisitems over ondernemen, belastingen en
// accountancy, gebruikt door de AI-assistent (zie src/lib/ai-assistent.ts,
// retrieveContext()) naast de bestaande Kenniscentrum-artikelen en de
// Belastingkalender. Zie README.md ("Kenniscentrum: AI-assistent") voor de
// volledige uitleg van de RAG-architectuur.
//
// BELANGRIJK — hoe deze kennisbank tot stand is gekomen:
// - Elk item is inhoudelijk herleidbaar tot een echte, bestaande pagina van
//   de Belastingdienst, KVK of Rijksoverheid (sourceUrl) — geen enkele URL
//   is verzonnen of geraden.
// - Bewust GEEN specifieke belastingtarieven, drempelbedragen, percentages,
//   deadlines of andere cijfers die jaarlijks kunnen wijzigen: de content
//   legt uit HOE iets werkt en verwijst voor actuele bedragen/percentages
//   naar sourceUrl. Dit voorkomt dat de site verouderde cijfers als feit
//   presenteert.
// - Bij een vraag die feitelijk van de persoonlijke situatie van de
//   bezoeker afhangt (bijv. "welke rechtsvorm moet ik kiezen"), legt de
//   AI-assistent de relevante algemene afwegingen uit en verwijst hij naar
//   Avydo voor advies op maat — dit wordt afgedwongen door de systeemprompt
//   in src/pages/api/kenniscentrum-chat.ts (verwijstNaarPersoonlijkAdvies),
//   niet per kennisitem.
//
// Structuur: per onderwerpcluster één bestand (ondernemingsvormen.ts,
// administratie.ts, btw.ts, inkomstenbelasting.ts, bv-dga.ts, personeel.ts),
// elk een simpele array van KnowledgeItem (zie ./types.ts). Dat houdt ieder
// bestand overzichtelijk en maakt uitbreiden eenvoudig.
//
// EEN NIEUW KENNISITEM TOEVOEGEN:
// 1. Kies het best passende bestaande onderwerpbestand hierboven, of maak
//    een nieuw bestand (bijv. `subsidies.ts`) met hetzelfde patroon:
//    `export const subsidiesItems: KnowledgeItem[] = [ ... ];`
// 2. Vul alle velden uit KnowledgeItem in (zie ./types.ts) — met name:
//    - `id`: uniek, kebab-case, wijzig dit nooit achteraf.
//    - `content`: algemene, controleerbare uitleg, GEEN bedragen/
//      percentages/termijnen die kunnen wijzigen (verwijs daarvoor naar
//      sourceUrl — zie hierboven).
//    - `sourceUrl`: een daadwerkelijk bestaande pagina van de Belasting-
//      dienst, KVK, Rijksoverheid of (waar relevant) de NBA — nooit een
//      verzonnen URL. Controleer de URL voordat u hem toevoegt.
//    - `lastVerified`: de datum (YYYY-MM-DD) waarop u sourceUrl en content
//      voor het laatst gecontroleerd heeft.
// 3. Importeer en spreid het nieuwe bestand hieronder in `knowledgeBase`
//    (nieuw bestand) of voeg het item toe aan de array in een bestaand
//    bestand. De retrieval (src/lib/knowledge-match.mjs) en de RAG-
//    integratie (ai-assistent.ts) hoeven niet aangepast te worden: elk
//    item in `knowledgeBase` wordt automatisch meegenomen in de zoekfunctie.
// 4. Voer `npm run kenniscentrum:test`, `npx astro check` en `npm run
//    build` uit om te controleren dat er geen fouten zijn.
//
// Periodiek onderhoud: controleer af en toe (bijv. jaarlijks, of wanneer
// een gebruiker een verouderd antwoord signaleert) of sourceUrl nog bestaat
// en inhoudelijk nog klopt, en werk lastVerified bij na controle.
import { administratieItems } from './administratie';
import { btwItems } from './btw';
import { bvDgaItems } from './bv-dga';
import { inkomstenbelastingItems } from './inkomstenbelasting';
import { ondernemingsvormenItems } from './ondernemingsvormen';
import { personeelItems } from './personeel';
import type { KnowledgeItem } from './types';

export type { KnowledgeItem } from './types';

export const knowledgeBase: KnowledgeItem[] = [
  ...ondernemingsvormenItems,
  ...administratieItems,
  ...btwItems,
  ...inkomstenbelastingItems,
  ...bvDgaItems,
  ...personeelItems,
];
