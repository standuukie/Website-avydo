// Opschoning Rijksoverheid-nieuws (2026-10-07): 16 artikelen zonder directe
// waarde voor de Avydo-doelgroep (belastingverdragen, een verlopen webinar,
// achterhaalde box 3-tussenfases en oude belastingjaren) staan op
// `hidden: true`. Ze verdwijnen daarmee van de nieuwspagina, de
// artikelpagina's en uit de AI-context (alle filteren op !data.hidden), maar
// blijven als bestand bestaan: de fetcher dedupliceert op de sourceUrl van
// alle bestanden in de content-map, dus een verwijderd bestand binnen de
// maxAgeMonths van de Rijksoverheid-bron zou bij een volgende run opnieuw
// worden geïmporteerd.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substituteExplicitSuccessors } from '../../src/lib/source-freshness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');

const ARTICLES = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const get = (key) => text.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
    return {
      file,
      category: get('category'),
      sourceName: get('sourceName'),
      sourceUrl: get('sourceUrl'),
      supersededBy: get('supersededBy'),
      hidden: get('hidden') === 'true',
    };
  });
const byFile = (file) => {
  const article = ARTICLES.find((a) => a.file === file);
  assert.ok(article, `${file} ontbreekt in de content-map`);
  return article;
};
const isActive = (file) => !byFile(file).hidden;

const VERDRAGEN = [
  '2024-03-12-nederland-en-bangladesh-ondertekenen-in-dhaka-nieuw-belastingverdrag.md',
  '2024-03-14-nederland-onderhandelt-in-2024-met-13-landen-over-belastingverdragen.md',
  '2025-02-19-nederland-heeft-met-bijna-100-landen-een-belastingverdrag.md',
  '2026-04-23-nederland-onderhandelt-met-4-nieuwe-landen-over-belastingverdrag.md',
  '2026-05-21-nederland-en-benin-ondertekenen-in-cotonou-nieuw-belastingverdrag.md',
  '2026-06-24-nederland-en-zweden-ondertekenen-nieuw-belastingverdrag.md',
];
const WEBINAR = '2024-11-06-webinar-over-zzp-en-schijnzelfstandigheid-op-donderdag-14-november-2024.md';
const VEROUDERD = [
  '2023-04-26-vier-opties-op-tafel-om-de-huidige-bepalingen-van-box-3-te-verfijnen.md',
  '2024-01-25-technische-verbeteringen-in-voorstel-nieuw-stelsel-box-3.md',
  '2024-06-06-reactie-op-uitspraak-hoge-raad-inzake-box-3.md',
  '2024-06-19-kabinet-stuurt-wetsvoorstel-voor-toekomstig-box-3-stelsel-naar-raad-van-state.md',
  '2024-07-18-1e-duiding-arresten-hoge-raad-box-3.md',
  '2024-12-13-nieuwe-box-3-stelsel-op-basis-van-werkelijk-rendement-uitgesteld.md',
  '2023-12-20-belangrijkste-belastingwijzigingen-per-1-januari-2024.md',
  '2024-12-18-in-2025-geen-boetes-bij-handhaving-schijnzelfstandigheid.md',
  '2024-12-18-kabinet-houdt-met-belastingwijzigingen-voor-2025-oog-voor-portemonnee-van-werken.md',
];
const VERBORGEN = [...VERDRAGEN, WEBINAR, ...VEROUDERD];

const ACTUEEL_SEP_OKT_2026 = [
  '2026-09-10-werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant.md',
  '2026-09-11-kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven.md',
  '2026-09-15-belastingplan-2027-voorstellen-voor-beter-werkend-belastingstelsel-en-gezonde-ov.md',
  '2026-09-15-prinsjesdag-2026-welvaart-opnieuw-verdienen.md',
  '2026-09-22-aanpassing-mededingingswet-beter-en-gerichter-toezicht-fusies-en-overnames.md',
  '2026-10-01-zelfstandigenwet-biedt-meer-duidelijkheid-en-erkenning-voor-zzp-ers.md',
];
const EXPLICIET_BEHOUDEN = [
  '2025-01-29-hogere-boetes-bij-illegale-arbeid.md',
  '2025-03-14-kabinet-stuurt-wetsvoorstel-tegenbewijsregeling-box-3-naar-tweede-kamer.md',
  '2025-03-27-ondernemerschap-blijft-volwaardig-criterium-bij-beoordelen-schijnzelfstandigheid.md',
  '2025-07-09-kabinet-verhoogt-boetes-voor-uitbuiting-van-arbeidskrachten.md',
  '2025-09-29-subsidie-voor-mbk-er-die-technologie-inzet-voor-werknemer-met-arbeidsbeperking.md',
  '2025-10-30-regeling-voor-huisvestingskosten-arbeidsmigranten-blijft-bestaan.md',
  '2025-11-11-eerste-kamer-stemt-in-met-strengere-regels-voor-de-uitleenmarkt.md',
  '2026-03-06-kabinet-kiest-voor-meer-rust-en-duidelijkheid-voor-zzp-ers-en-opdrachtgevers.md',
  '2026-03-13-kabinet-komt-met-betaalbare-basisverzekering-voor-zelfstandigen-bij-arbeidsonges.md',
  '2026-04-01-start-internetconsultatie-belastingmaatregelen-om-startups-en-scale-ups-te-onder.md',
  '2026-04-02-sneller-duidelijkheid-voor-werkgevers-over-re-integratie-zieke-werknemer.md',
  '2026-04-08-vaste-loonkostensubsidie-voor-werknemer-in-beschutte-werkomgeving.md',
  '2026-05-22-internetconsultatie-zorgplicht-voor-uitleners-van-start.md',
  '2026-07-10-kabinet-wil-meer-zekerheid-voor-werkgevers-bij-re-integratie.md',
  ...ACTUEEL_SEP_OKT_2026,
];
const ZZP_ARTIKELEN = [
  '2025-03-27-ondernemerschap-blijft-volwaardig-criterium-bij-beoordelen-schijnzelfstandigheid.md',
  '2026-03-06-kabinet-kiest-voor-meer-rust-en-duidelijkheid-voor-zzp-ers-en-opdrachtgevers.md',
  '2026-10-01-zelfstandigenwet-biedt-meer-duidelijkheid-en-erkenning-voor-zzp-ers.md',
];
const VBAR = '2025-07-07-wetsvoorstel-voor-meer-duidelijkheid-zzp-ers-en-sterkere-positie-laagbetaalde-sc.md';
const ZZP_RUST = '2026-03-06-kabinet-kiest-voor-meer-rust-en-duidelijkheid-voor-zzp-ers-en-opdrachtgevers.md';

test('opschoning: de 6 belastingverdrag-artikelen zijn niet actief', () => {
  for (const file of VERDRAGEN) assert.equal(isActive(file), false, file);
});

test('opschoning: het verlopen webinar (14 november 2024) is niet actief', () => {
  assert.equal(isActive(WEBINAR), false);
});

test('opschoning: de achterhaalde box 3-tussenfases en oude belastingjaren (2024/2025) zijn niet actief', () => {
  for (const file of VEROUDERD) assert.equal(isActive(file), false, file);
});

test('opschoning: verborgen artikelen blijven als Rijksoverheid-bestand met sourceUrl bestaan (de fetcher importeert ze dus niet opnieuw)', () => {
  for (const file of VERBORGEN) {
    const article = byFile(file);
    assert.equal(article.sourceName, 'Rijksoverheid', file);
    assert.match(article.sourceUrl ?? '', /^https:\/\/www\.rijksoverheid\.nl\//, file);
  }
});

test('opschoning: precies deze 16 Rijksoverheid-artikelen zijn verborgen; 32 blijven actief', () => {
  const rijksoverheid = ARTICLES.filter((a) => a.sourceName === 'Rijksoverheid');
  assert.deepEqual(rijksoverheid.filter((a) => a.hidden).map((a) => a.file).sort(), [...VERBORGEN].sort());
  assert.equal(rijksoverheid.filter((a) => !a.hidden).length, 32);
});

test('behoud: de actuele artikelen uit september/oktober 2026 blijven actief', () => {
  for (const file of ACTUEEL_SEP_OKT_2026) assert.equal(isActive(file), true, file);
});

test('behoud: alle expliciet te behouden artikelen blijven actief', () => {
  for (const file of EXPLICIET_BEHOUDEN) assert.equal(isActive(file), true, file);
});

test('categorie: de drie zzp-artikelen staan onder "Ondernemen & rechtsvormen"', () => {
  for (const file of ZZP_ARTIKELEN) assert.equal(byFile(file).category, 'Ondernemen & rechtsvormen', file);
});

test('historisch: de opgevolgde artikelen blijven actief en verwijzen naar een actieve opvolger', () => {
  const marked = ARTICLES.filter((a) => a.supersededBy);
  assert.equal(marked.length, 4);
  for (const article of marked) {
    assert.equal(article.hidden, false, article.file);
    const successors = ARTICLES.filter((a) => a.sourceUrl === article.supersededBy);
    assert.equal(successors.length, 1, article.file);
    assert.equal(successors[0].hidden, false, article.file);
  }
});

test('historisch: het Vbar-wetsvoorstel van 07-07-2025 is opgevolgd door 06-03-2026 en wordt na selectie door die opvolger vervangen', () => {
  const vbar = byFile(VBAR);
  const zzpRust = byFile(ZZP_RUST);
  assert.equal(vbar.supersededBy, zzpRust.sourceUrl);
  assert.equal(zzpRust.supersededBy, undefined);
  const active = ARTICLES.filter((a) => !a.hidden);
  assert.deepEqual(substituteExplicitSuccessors([vbar], active).map((a) => a.file), [ZZP_RUST]);
});
