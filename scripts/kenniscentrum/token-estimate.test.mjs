// Regressietests voor de lokale tokenschatting (src/lib/token-estimate.mjs)
// en voor het daadwerkelijke tokenbudget van de systeemprompt + tool-schema
// in de echte route (src/pages/api/kenniscentrum-chat.ts) — dit zijn de
// VASTE kosten die op ELK verzoek meetellen voor Groq's tokens-per-minuut-
// limiet (zie het TPM-incident in die route). Draait met Node's ingebouwde
// testrunner: `npm run kenniscentrum:test`, geen live Groq-aanroep nodig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, estimateTotalTokens } from '../../src/lib/token-estimate.mjs';

test('estimateTokens geeft 0 voor lege/ontbrekende tekst', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(null), 0);
});

test('estimateTokens schaalt ruwweg met de tekstlengte (~4 tekens/token)', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens('a'.repeat(401)), 101); // rond naar boven af
});

test('estimateTotalTokens telt de schatting van meerdere tekststukken op', () => {
  assert.equal(estimateTotalTokens(['abcd', 'abcd', '']), 2);
  assert.equal(estimateTotalTokens([]), 0);
});

// ---------------------------------------------------------------------
// Structurele controle van de ECHTE route: haalt de systeemprompt en het
// tool-schema (ANSWER_TOOL) letterlijk uit de bron (geen TS-import nodig,
// zelfde patroon als elders in deze testset) en bevestigt dat het
// GECOMBINEERDE, VASTE tokenbudget onder een veilige grens blijft — dit is
// precies de regressie die moet voorkomen dat de systeemprompt in een
// volgende ronde weer aangroeit tot het punt waarop een paar verzoeken
// Groq's TPM-budget (8.000/minuut) al kunnen opsouperen (zie het
// "eerst werken meerdere vragen, dan faalt zelfs een simpele vraag"-
// incident).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_FILE = path.resolve(__dirname, '../../src/pages/api/kenniscentrum-chat.ts');

function extractSystemPromptAndSchema() {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const promptMatch = text.match(/function buildSystemPrompt\(\): string \{[\s\S]*?\n  return `([\s\S]*?)`;\n\}/);
  assert.ok(promptMatch, 'kon de systeemprompt-template niet uit de route halen');
  const toolMatch = text.match(/const ANSWER_TOOL: ToolDefinition = \{[\s\S]*?\n\};/);
  assert.ok(toolMatch, 'kon ANSWER_TOOL niet uit de route halen');
  return { systemPrompt: promptMatch[1], toolSchemaSource: toolMatch[0] };
}

test('de systeemprompt + tool-schema samen kosten (proxy-meting) minder dan 1.800 tokens', () => {
  const { systemPrompt, toolSchemaSource } = extractSystemPromptAndSchema();
  const fixedCostTokens = estimateTokens(systemPrompt) + estimateTokens(toolSchemaSource);
  // Ronde 4: verlaagd van <3.000 naar <1.800. Dit is een PROXY-meting (de
  // volledige broncode van het ANSWER_TOOL-blok, niet exact wat de route
  // daadwerkelijk verstuurt — zie TOOL_SCHEMA_TOKENS in kenniscentrum-chat.ts
  // voor de precieze berekening), maar wel een consistente regressiegrendel:
  // vóór ronde 4 was dit ~2.790 (systeemprompt 2.383 + schema 407), ná ronde
  // 4 ~1.426 — een simulatie tegen de echte kennisbank liet zien dat dit de
  // dominante hefboom was om een heel gesprek (10-15 vragen) binnen Groq's
  // TPM-budget te houden (zie rate-limit.test.mjs voor de simulatie zelf).
  assert.ok(
    fixedCostTokens < 1_800,
    `systeemprompt + tool-schema kosten nu ~${fixedCostTokens} tokens (was ~2.790 vóór ronde 4) — dat is te dicht bij Groq's TPM-budget van 8.000/minuut; kort de systeemprompt verder in`,
  );
});

test('GROQ_TPM_LIMIT heeft een veilige, geconfigureerde marge onder Groq\'s daadwerkelijke 8.000 TPM', () => {
  const text = readFileSync(ROUTE_FILE, 'utf-8');
  const match = text.match(/const DEFAULT_GROQ_TPM_LIMIT = ([\d_]+);/);
  assert.ok(match, 'DEFAULT_GROQ_TPM_LIMIT niet gevonden in de route');
  const value = Number(match[1].replace(/_/g, ''));
  assert.ok(value < 8_000, `DEFAULT_GROQ_TPM_LIMIT (${value}) moet lager zijn dan Groq's echte TPM-limiet (8.000) — nooit exact gelijk, zie opdracht`);
  assert.ok(value >= 6_500, `DEFAULT_GROQ_TPM_LIMIT (${value}) lijkt onnodig laag gezien het nu veel lagere tokenverbruik per verzoek (zie de systeemprompt-test hierboven)`);
});
