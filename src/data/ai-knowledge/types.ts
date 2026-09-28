// Gedeeld type voor de Avydo AI-kennisbank (src/data/ai-knowledge/).
// Zie src/data/ai-knowledge/index.ts voor uitleg over de opzet en hoe je
// hier een nieuw kennisitem aan toevoegt.
import type { BusinessAudience } from '@/data/belastingkalender';

export interface KnowledgeItem {
  /** Uniek, stabiel, kebab-case id (bv. "btw-kor"). Wijzig dit nooit achteraf. */
  id: string;
  title: string;
  category: string;
  /**
   * Algemene, controleerbare uitleg. Bewust GEEN specifieke bedragen,
   * percentages, drempels of deadlines die jaarlijks kunnen wijzigen — voor
   * actuele cijfers verwijst content altijd naar sourceUrl. Zie de
   * toelichting in index.ts.
   */
  content: string;
  targetAudience: BusinessAudience[];
  sourceName: string;
  /** Echte, gecontroleerde URL. Nooit een verzonnen of geraden pagina. */
  sourceUrl: string;
  /** Datum (YYYY-MM-DD) waarop sourceUrl/content voor het laatst gecontroleerd is. */
  lastVerified: string;
  tags: string[];
  /** 1 (specifiek) t/m 3 (breed/veelgevraagd) — tie-breaker bij gelijke score in de retrieval. */
  priority: 1 | 2 | 3;
}
