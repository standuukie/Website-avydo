// Opschoning Rijksoverheid-nieuws (2026-10-07), twee rondes. Ronde 1: 16 artikelen zonder directe
// waarde voor de Avydo-doelgroep (belastingverdragen, een verlopen webinar,
// achterhaalde box 3-tussenfases en oude belastingjaren) werden verborgen.
// Sinds de omzetting naar Avydo-artikelen (2026-10-08) staan deze bronnen
// niet meer als (verborgen) artikel in de content-map, maar als afgewezen
// bronrecord in de bronlaag (src/content/bronnen/<oude slug>.json). De
// import dedupliceert op de bronlaag, dus ze worden niet opnieuw opgehaald.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substituteExplicitSuccessors } from '../../src/lib/source-freshness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../src/content/kenniscentrum');
const SOURCES_DIR = path.resolve(__dirname, '../../src/content/bronnen');
const recordFor = (file) => {
  const p = path.join(SOURCES_DIR, file.replace(/\.md$/, '.json'));
  return JSON.parse(readFileSync(p, 'utf8'));
};
const hasArticle = (file) => readdirSync(CONTENT_DIR).includes(file);

const ARTICLES = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const get = (key) => text.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
    return {
      file,
      title: get('title'),
      summary: get('summary'),
      relevance: get('relevance'),
      priority: get('priority'),
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
// Ronde 2 (redactionele audit): beperkte waarde voor de Avydo-doelgroep.
const VERBORGEN_RONDE_2 = [
  // Consultatiefase uit 2024; dezelfde wet staat in het bericht van 07-07-2025.
  '2024-10-24-internetconsultatie-voor-wetsvoorstel-rapportageverplichting-crypto-aanbieders.md',
  // Beleidsverkenning met een keuzemoment in 2025; de uitkomst staat niet in de bronselectie.
  '2025-02-07-mogelijke-alternatieven-voor-verhoging-btw-in-kaart-gebracht.md',
  // Beurshandel en pensioenfondsen; geen praktische gevolgen voor een DGA met eigen bv.
  '2025-06-27-kabinet-kijkt-naar-aanvullende-mogelijkheden-dividendstripping-aan-te-pakken.md',
  // Technische antimisbruikmaatregel voor beleggers in obligaties.
  '2025-08-25-kabinet-dicht-belastinglek-in-box-3-bij-obligaties.md',
  // Algemeen begrotingsnieuws; de ondernemersmaatregelen staan in het Belastingplan 2027-bericht.
  '2026-09-15-prinsjesdag-2026-welvaart-opnieuw-verdienen.md',
  // Fusietoezicht voor bedrijven met tientallen miljoenen omzet.
  '2026-09-22-aanpassing-mededingingswet-beter-en-gerichter-toezicht-fusies-en-overnames.md',
];
const VERBORGEN = [...VERDRAGEN, WEBINAR, ...VEROUDERD, ...VERBORGEN_RONDE_2];

const ACTUEEL_SEP_OKT_2026 = [
  '2026-09-10-werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant.md',
  '2026-09-11-kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven.md',
  '2026-09-15-belastingplan-2027-voorstellen-voor-beter-werkend-belastingstelsel-en-gezonde-ov.md',
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

test('opschoning: de 6 belastingverdrag-artikelen zijn geen artikel meer, alleen een afgewezen bron', () => {
  for (const file of VERDRAGEN) {
    assert.equal(hasArticle(file), false, file);
    assert.equal(recordFor(file).processingStatus, 'afgewezen', file);
  }
});

test('opschoning: het verlopen webinar (14 november 2024) is geen artikel meer, alleen een afgewezen bron', () => {
  assert.equal(hasArticle(WEBINAR), false);
  assert.equal(recordFor(WEBINAR).processingStatus, 'afgewezen');
});

test('opschoning: de achterhaalde box 3-tussenfases en oude belastingjaren (2024/2025) zijn geen artikel meer', () => {
  for (const file of VEROUDERD) {
    assert.equal(hasArticle(file), false, file);
    assert.equal(recordFor(file).processingStatus, 'afgewezen', file);
  }
});

test('opschoning ronde 2: crypto-consultatie 2024, btw-alternatieven, dividendstripping, box 3-obligatielek, Prinsjesdag-macronieuws en Mededingingswet zijn geen artikel meer', () => {
  for (const file of VERBORGEN_RONDE_2) {
    assert.equal(hasArticle(file), false, file);
    assert.equal(recordFor(file).processingStatus, 'afgewezen', file);
  }
});

test('opschoning: de opgeschoonde bronnen blijven als Rijksoverheid-bronrecord met sourceUrl bestaan (de import haalt ze dus niet opnieuw op)', () => {
  for (const file of VERBORGEN) {
    const record = recordFor(file);
    assert.equal(record.sourceName, 'Rijksoverheid', file);
    assert.match(record.sourceUrl ?? '', /^https:\/\/www\.rijksoverheid\.nl\//, file);
    assert.ok(record.rejectionReason, file);
  }
});

test('opschoning: precies 26 Rijksoverheid-artikelen zijn zichtbaar; de 22 opgeschoonde zijn er niet meer', () => {
  const rijksoverheid = ARTICLES.filter((a) => a.sourceName === 'Rijksoverheid');
  assert.equal(rijksoverheid.filter((a) => a.hidden).length, 0);
  assert.equal(rijksoverheid.length, 26);
  for (const file of VERBORGEN) assert.equal(rijksoverheid.some((a) => a.file === file), false, file);
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

// --- Redactionele audit (2026-10-07) ---

const ACTIEF_RO = ARTICLES.filter((a) => a.sourceName === 'Rijksoverheid' && !a.hidden);
// Vaste sjabloonzinnen van de fetcher (RELEVANCE_TEMPLATES in fetch-articles.mjs).
const SJABLOONZINNEN = [
  'Controleer of deze wijziging van toepassing is op uw situatie',
  'Controleer wat dit concreet voor uw organisatie betekent',
  'Bekijk de volledige publicatie om te bepalen of actie nodig is',
  'Bespreek met uw accountant of dit gevolgen heeft',
  'Bespreek met uw adviseur of dit voor uw situatie relevant is',
];

test('redactie: elk actief Rijksoverheid-artikel heeft een eigen, onderwerpspecifieke duiding (geen sjabloonzin, geen duplicaat)', () => {
  for (const a of ACTIEF_RO) {
    for (const zin of SJABLOONZINNEN) assert.equal(a.relevance.includes(zin), false, `${a.file}: ${zin}`);
  }
  assert.equal(new Set(ACTIEF_RO.map((a) => a.relevance)).size, ACTIEF_RO.length);
});

test('redactie: geen actieve Rijksoverheid-samenvatting eindigt afgekapt op "..."', () => {
  for (const a of ACTIEF_RO) {
    assert.equal(/(\.\.\.|…)$/.test(a.summary), false, a.file);
    assert.match(a.summary, /[.!?]$/, a.file);
  }
});

test('redactie: opgevolgde artikelen zijn in titel en duiding herkenbaar als achterhaald en worden niet als "belangrijk" uitgelicht', () => {
  for (const a of ACTIEF_RO.filter((x) => x.supersededBy)) {
    assert.match(a.title, /\((inmiddels herzien|deels geschrapt|eerdere fase)\)/, a.file);
    assert.match(a.relevance, /^Let op:/, a.file);
    assert.notEqual(a.priority, 'belangrijk', a.file);
  }
});

test('redactie: voorstellen en voornemens worden niet als geldende regel gepresenteerd', () => {
  const statusInTitel = {
    '2026-09-10-werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant.md': /^Voornemen:/,
    '2026-04-08-vaste-loonkostensubsidie-voor-werknemer-in-beschutte-werkomgeving.md': /^Voorstel:/,
    '2026-04-01-start-internetconsultatie-belastingmaatregelen-om-startups-en-scale-ups-te-onder.md': /^Voorstel:/,
    '2026-05-22-internetconsultatie-zorgplicht-voor-uitleners-van-start.md': /^Voorstel zorgplicht:/,
    '2026-10-01-zelfstandigenwet-biedt-meer-duidelijkheid-en-erkenning-voor-zzp-ers.md': /in consultatie/,
  };
  for (const [file, re] of Object.entries(statusInTitel)) assert.match(byFile(file).title, re, file);
  const statusInDuiding = {
    '2026-09-10-werkgever-mag-geen-huur-meer-inhouden-op-minimumloon-arbeidsmigrant.md': /voornemen, nog geen geldende regel/,
    '2026-03-13-kabinet-komt-met-betaalbare-basisverzekering-voor-zelfstandigen-bij-arbeidsonges.md': /kabinetsplan, nog geen geldende wet/,
    '2026-09-11-kabinet-kiest-voor-invoering-e-facturatie-en-rapportage-voor-bedrijven.md': /nog geen wet/,
    '2026-09-15-belastingplan-2027-voorstellen-voor-beter-werkend-belastingstelsel-en-gezonde-ov.md': /Het zijn voorstellen/,
    '2026-04-02-sneller-duidelijkheid-voor-werkgevers-over-re-integratie-zieke-werknemer.md': /nog niet ingevoerd/,
    '2026-07-10-kabinet-wil-meer-zekerheid-voor-werkgevers-bij-re-integratie.md': /nog niet ingevoerd/,
    '2025-04-14-nederland-wijzigt-belastingverdrag-met-duitsland-voor-grenswerkers.md': /geldt pas nadat/,
  };
  for (const [file, re] of Object.entries(statusInDuiding)) assert.match(byFile(file).relevance, re, file);
  // De geldende huisvestingsregel blijft als geldend benoemd.
  assert.match(byFile('2025-10-30-regeling-voor-huisvestingskosten-arbeidsmigranten-blijft-bestaan.md').relevance, /^Dit is de geldende regel/);
});

test('redactie: gecorrigeerde categorieën (lijfrente, Vbar) en titel zonder typefout (mkb)', () => {
  assert.equal(byFile('2025-04-25-kabinet-treft-maatregelen-tegen-belastingontwijking-met-lijfrentes.md').category, 'Inkomstenbelasting');
  assert.equal(byFile(VBAR).category, 'Ondernemen & rechtsvormen');
  assert.match(byFile('2025-09-29-subsidie-voor-mbk-er-die-technologie-inzet-voor-werknemer-met-arbeidsbeperking.md').title, /^Subsidie voor mkb’er/);
});
