// TIJDELIJK, READ-ONLY diagnosescript — haalt en analyseert uitsluitend
// het ene, al bekende artikel "Transacties met crypto straks meer in
// beeld bij Belastingdienst" (candidate-index 1667 uit de vorige
// deep-scan-audit), om de relevantielogica op commit 3859281 te
// verifiëren tegen de daadwerkelijke, volledige broninhoud. Schrijft
// niets naar src/content/kenniscentrum, publiceert niets. Wordt na
// gebruik weer verwijderd.
//
// Gebruikt uitsluitend de bestaande, ongewijzigde functies uit
// fetch-articles.mjs/sources.config.mjs — geen eigen matchingregels.

import {
  extractPageTitle,
  extractMetaDescription,
  extractMinistryTag,
  scoreCategories,
} from './fetch-articles.mjs';
import { sources, rijksoverheidAudienceSignals } from './sources.config.mjs';

const rijksoverheidSource = sources.find((s) => s.id === 'rijksoverheid-nieuws');

const URL = 'https://www.rijksoverheid.nl/actueel/nieuws/2025/07/07/transacties-met-crypto-straks-meer-in-beeld-bij-belastingdienst';

// Letterlijke kopie van MINISTRY_BYPASS_EXCLUDED_TERMS /
// MINISTRY_BYPASS_REQUIRED_TERMS uit fetch-articles.mjs (commit 3859281)
// — uitsluitend voor rapportage, dezelfde methode als de vorige audits.
const EXCLUDED_TERMS_MIRROR = ['zorgtoeslag', 'huurtoeslag', 'kinderopvangtoeslag', 'kindgebonden budget'];
const REQUIRED_TERMS_MIRROR = ['belasting', 'fisca'];

async function main() {
  const res = await fetch(URL, {
    headers: { 'User-Agent': 'AvydoKenniscentrumBot/1.0 (+https://www.avydo.nl)' },
  });
  console.log('HTTP_STATUS:', res.status);
  if (!res.ok) {
    console.log('FOUT: kon artikelpagina niet ophalen');
    return;
  }
  const html = await res.text();

  const title = extractPageTitle(html);
  const description = extractMetaDescription(html);
  const ministry = extractMinistryTag(html);

  console.log('TITLE:', JSON.stringify(title));
  console.log('DESCRIPTION:', JSON.stringify(description));
  console.log('MINISTRY:', JSON.stringify(ministry));

  // Volledige <body>-tekst (gestript van tags) voor een zo compleet
  // mogelijk beeld van de daadwerkelijke pagina-inhoud, niet alleen de
  // meta-description die de productiepipeline normaal gebruikt.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const rawBody = bodyMatch ? bodyMatch[1] : html;
  const plainText = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  console.log('FULL_PAGE_TEXT_LENGTH:', plainText.length);
  console.log('FULL_PAGE_TEXT:', plainText);

  const combinedText = `${title} ${description}`;
  const lower = combinedText.toLowerCase();
  const scores = scoreCategories(combinedText);
  const audienceMatch = rijksoverheidSource.audienceSignals?.some((kw) => lower.includes(kw)) ?? false;
  const excludedTermsPresent = EXCLUDED_TERMS_MIRROR.filter((t) => lower.includes(t));
  const withoutOrgName = lower.replaceAll('belastingdienst', '');
  const hasBelasting = withoutOrgName.includes('belasting');
  const hasFisca = withoutOrgName.includes('fisca');
  const ministryMatchMirror =
    ministry === rijksoverheidSource.ministryBypass &&
    excludedTermsPresent.length === 0 &&
    (hasBelasting || hasFisca);
  const relevant = Object.keys(scores).length > 0 || ministryMatchMirror || audienceMatch;

  console.log('CATEGORY_SCORES:', JSON.stringify(scores));
  console.log('AUDIENCE_MATCH:', audienceMatch);
  console.log('EXCLUDED_TERMS_PRESENT:', JSON.stringify(excludedTermsPresent));
  console.log('HAS_BELASTING_STEM:', hasBelasting);
  console.log('HAS_FISCA_STEM:', hasFisca);
  console.log('MINISTRY_MATCH_MIRROR:', ministryMatchMirror);
  console.log('RELEVANT_MIRROR:', relevant);

  // Losse full-text checks voor de specifieke termen die de opdracht
  // vraagt te controleren — puur substring-aanwezigheid, ter info.
  const fullLower = plainText.toLowerCase();
  const termsToCheck = [
    'crypto', 'cryptovaluta', 'crypto-transactie', 'rapportage', 'gegevensuitwisseling',
    'informatieplicht', 'aangifte', 'fiscale verplichting', 'belastingdienst', 'belasting',
    'fiscaal', 'fiscale', 'cara', 'crypto-asset', 'meldingsplicht', 'uitwisseling',
  ];
  console.log('FULL_TEXT_TERM_PRESENCE:', JSON.stringify(
    Object.fromEntries(termsToCheck.map((t) => [t, fullLower.includes(t)])),
  ));
}

main().catch((err) => {
  console.error('FOUT:', err);
  process.exit(1);
});
