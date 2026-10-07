// Redactionele weergave van het Kenniscentrum (2026-10-07): sjabloon-duidingen
// niet tonen, nieuws en naslag scheiden, statusbadges, de Intermediairdagen
// uit de nieuwsselectie en de Rijksoverheid-brontekst met echte tussenkoppen.
// Alles hier is weergave; de AI-context en -retrieval blijven ongewijzigd.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERIC_RELEVANCE_TEXTS,
  hasOwnRelevance,
  isReferenceArticle,
  isHeadingBlock,
  sourceBodyBlocks,
  STATUS_LABELS,
  dateIsSourceLastModified,
} from '../../src/lib/news-presentation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(ROOT, 'src/content/kenniscentrum');

const ARTICLES = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const [, frontmatter = '', body = ''] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    const get = (key) => frontmatter.match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1];
    return {
      file,
      body,
      title: get('title'),
      summary: get('summary'),
      relevance: get('relevance')?.replace(/\\"/g, '"'),
      sourceName: get('sourceName'),
      sourceUrl: get('sourceUrl'),
      contentType: get('contentType'),
      status: get('status'),
      avydoContent: get('avydoContent'),
      hidden: get('hidden') === 'true',
      fetched: get('fetchedAt') != null,
    };
  });
const ACTIVE = ARTICLES.filter((a) => !a.hidden);
const ACTIVE_RO = ACTIVE.filter((a) => a.sourceName === 'Rijksoverheid');
const byFile = (file) => {
  const article = ARTICLES.find((a) => a.file === file);
  assert.ok(article, `${file} ontbreekt in de content-map`);
  return article;
};

test('GENERIC_RELEVANCE_TEXTS bevat alle sjablonen van de nieuwsengine', () => {
  const source = readFileSync(path.join(ROOT, 'scripts/kenniscentrum/fetch-articles.mjs'), 'utf8');
  const block = source.match(/const RELEVANCE_TEMPLATES = \{([\s\S]*?)\n\};/)?.[1];
  assert.ok(block, 'RELEVANCE_TEMPLATES niet gevonden in fetch-articles.mjs');
  const templates = [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(templates.length, 8);
  for (const t of templates) assert.ok(GENERIC_RELEVANCE_TEXTS.has(t), `sjabloon ontbreekt: ${t.slice(0, 50)}`);
});

test('hasOwnRelevance: sjablonen en lege teksten zijn geen eigen duiding', () => {
  for (const t of GENERIC_RELEVANCE_TEXTS) assert.equal(hasOwnRelevance(t), false);
  assert.equal(hasOwnRelevance(''), false);
  assert.equal(hasOwnRelevance(undefined), false);
  assert.equal(hasOwnRelevance('Belangrijk voor werkgevers: per 1 januari verandert de premie.'), true);
});

test('alle actieve Rijksoverheid-artikelen en handgeschreven gidsen houden hun eigen duiding', () => {
  assert.equal(ACTIVE_RO.length, 26);
  for (const a of ACTIVE_RO) assert.ok(hasOwnRelevance(a.relevance), `${a.file}: geen eigen duiding`);
  const guides = ACTIVE.filter((a) => !a.fetched);
  assert.ok(guides.length >= 12);
  for (const a of guides) assert.ok(hasOwnRelevance(a.relevance), `${a.file}: geen eigen duiding`);
});

test('sjabloon-duidingen komen alleen voor bij automatisch opgehaalde KVK-/Belastingdienst-artikelen', () => {
  const generic = ACTIVE.filter((a) => !hasOwnRelevance(a.relevance));
  assert.ok(generic.length > 0);
  for (const a of generic) {
    assert.ok(a.fetched, `${a.file}: sjabloon bij een handgeschreven artikel`);
    assert.ok(['KVK', 'Belastingdienst'].includes(a.sourceName), `${a.file}: sjabloon bij ${a.sourceName}`);
  }
});

test('nieuws en naslag: gidsen en KVK-kennisartikelen zijn naslag, nieuwsberichten nieuws', () => {
  const guides = ACTIVE.filter((a) => a.avydoContent === 'gids');
  assert.equal(guides.length, 12);
  for (const a of guides) {
    assert.ok(a.file.startsWith('2026-10-01-'), a.file);
    assert.equal(a.contentType, 'naslag', a.file);
    assert.equal(isReferenceArticle(a), true);
  }
  // Opschoonronde 2026-10-07: berichten die inmiddels als naslag functioneren.
  for (const file of [
    '2026-09-15-wat-betekent-prinsjesdag-voor-jouw-bedrijf.md',
    '2025-11-03-nieuw-vanaf-2026-herziening-btw-aftrek-bij-investeringsdiensten.md',
    '2025-10-30-vanaf-1-januari-2026-btw-tarief-logies-omhoog-naar-21.md',
    '2025-01-29-hogere-boetes-bij-illegale-arbeid.md',
    '2023-12-11-nieuwe-overeenkomst-met-belgie-geeft-duidelijkheid-bij-thuiswerkende-werknemers.md',
  ]) {
    assert.equal(isReferenceArticle(byFile(file)), true, file);
  }
  assert.equal(ACTIVE.filter((a) => a.contentType === 'naslag').length, 17);
  assert.equal(isReferenceArticle(byFile('2025-03-31-kvk-opstelportaal-voor-middelgroot-verdwijnt.md')), false);
  const kvkNews = ACTIVE.filter((a) => a.sourceName === 'KVK' && a.contentType === 'nieuws');
  assert.equal(kvkNews.length, 3);
  // Rijksoverheid is nieuws, behalve de twee berichten die inmiddels als naslag functioneren.
  const roNaslag = ACTIVE_RO.filter((a) => isReferenceArticle(a)).map((a) => a.file).sort();
  assert.deepEqual(roNaslag, [
    '2023-12-11-nieuwe-overeenkomst-met-belgie-geeft-duidelijkheid-bij-thuiswerkende-werknemers.md',
    '2025-01-29-hogere-boetes-bij-illegale-arbeid.md',
  ]);
  // Zonder veld: KVK = naslag, andere bronnen = nieuws.
  assert.equal(isReferenceArticle({ sourceName: 'KVK' }), true);
  assert.equal(isReferenceArticle({ sourceName: 'Belastingdienst' }), false);
  assert.equal(isReferenceArticle({ sourceName: 'KVK', contentType: 'nieuws' }), false);
});

test('Intermediairdagen staan niet meer in de nieuwsselectie, maar blijven bestaan voor deduplicatie', () => {
  for (const file of [
    '2026-10-05-schrijf-u-nu-in-voor-de-intermediairdagen-2026.md',
    '2026-09-14-intermediairdagen-2026-belastingplan-2027-kennissessies-en-netwerkkansen.md',
  ]) {
    const a = byFile(file);
    assert.equal(a.hidden, true, `${file} moet hidden zijn`);
    assert.match(a.sourceUrl ?? '', /^https:\/\//);
  }
  assert.ok(!ACTIVE.some((a) => /intermediairdagen/i.test(a.title ?? '')));
});

test('statuswaarden zijn geldig en staan op de bedoelde artikelen', () => {
  for (const a of ARTICLES.filter((x) => x.status)) {
    assert.ok(a.status in STATUS_LABELS, `${a.file}: onbekende status ${a.status}`);
  }
  const statusOf = (prefix) => ARTICLES.find((a) => a.file.startsWith(prefix))?.status;
  assert.equal(statusOf('2025-02-06-afschaffen-van-inhoudingen'), 'herzien');
  assert.equal(statusOf('2025-05-09-internetconsultatie-afschaffen'), 'herzien');
  assert.equal(statusOf('2025-09-12-wetsvoorstel-voor-basisverzekering'), 'historisch');
  assert.equal(statusOf('2025-07-07-wetsvoorstel-voor-meer-duidelijkheid'), 'deels-geschrapt');
  assert.equal(statusOf('2026-10-01-zelfstandigenwet'), 'consultatie');
  // Geverifieerd 2026-10-07: inmiddels aangenomen en van kracht.
  assert.equal(statusOf('2025-07-07-transacties-met-crypto'), 'van-kracht');
  assert.equal(statusOf('2025-04-25-kabinet-treft-maatregelen'), 'van-kracht');
  assert.equal(statusOf('2025-03-14-kabinet-stuurt-wetsvoorstel-tegenbewijsregeling'), 'van-kracht');
  // Huidige regel (van kracht) naast het voornemen om die per 2028 af te schaffen.
  assert.equal(statusOf('2025-10-30-regeling-voor-huisvestingskosten'), 'van-kracht');
  assert.equal(statusOf('2026-09-10-werkgever-mag-geen-huur'), 'voornemen');
  // Subsidie gesloten; Vbar-aanpassing ingehaald door het schrappen in maart 2026.
  assert.equal(statusOf('2025-09-29-subsidie-voor-mbk'), 'historisch');
  assert.equal(statusOf('2025-03-27-ondernemerschap-blijft'), 'historisch');
});

test('ongeschikte artikelen zijn verborgen, niet verwijderd (sourceUrl blijft voor deduplicatie)', () => {
  for (const prefix of [
    '2026-08-18-geen-verzuimboete-minimumbelasting', '2026-08-18-bent-u-cryptodienstverlener',
    '2026-08-03-begin-augustus-herinneren', '2026-07-09-handboek-milieubelastingen',
    '2026-06-30-voorkom-dubbele-accijns', '2026-05-08-zo-bepaal-je-de-juiste-douanewaarde',
    '2026-04-02-zo-check-je-hoe-je-zakenrelatie', '2026-03-03-deponeren.md',
    '2026-02-24-handleiding-waardering-van-verpachte', '2026-01-29-kvk-prinsjesdag-2025',
    '2026-01-02-landelijke-landbouwnormen', '2025-12-03-vanaf-1-januari-2026-btwwft',
    '2025-06-24-drijvende-huizen', '2025-01-07-fusie-splitsing', '2024-01-22-goederen-inklaren',
  ]) {
    const matches = ARTICLES.filter((a) => a.file.startsWith(prefix));
    assert.equal(matches.length, 1, prefix);
    assert.equal(matches[0].hidden, true, prefix);
    assert.match(matches[0].sourceUrl ?? '', /^https:\/\//, prefix);
  }
  // Nog actueel volgens KVK (portaal verdwijnt "binnenkort"): blijft zichtbaar.
  assert.equal(byFile('2025-03-31-kvk-opstelportaal-voor-middelgroot-verdwijnt.md').hidden, false);
});

test('eigen Avydo-content: 12 gidsen en 1 toelichting, met de geraadpleegde bron behouden', () => {
  const own = ARTICLES.filter((a) => a.avydoContent);
  assert.equal(own.length, 13);
  for (const a of own) {
    assert.ok(['Belastingdienst', 'KVK'].includes(a.sourceName), a.file);
    assert.match(a.sourceUrl ?? '', /^https:\/\/www\.(belastingdienst|kvk)\.nl\//, a.file);
  }
  for (const a of own.filter((x) => x.avydoContent === 'gids')) assert.equal(a.fetched, false, a.file);
  const toelichting = own.filter((a) => a.avydoContent === 'toelichting');
  assert.deepEqual(toelichting.map((a) => a.file), ['2026-09-15-belastingplan-2027-op-rijksoverheid-nl-staan-de-voorgestelde-veranderingen.md']);
});

test('datumweergave: een KVK-sitemapdatum wordt als "bijgewerkt" getoond, niet als publicatiedatum', () => {
  assert.equal(dateIsSourceLastModified({ sourceName: 'KVK', fetchedAt: '2026-10-01' }), true);
  assert.equal(dateIsSourceLastModified({ sourceName: 'KVK', fetchedAt: undefined, avydoContent: 'gids' }), false);
  assert.equal(dateIsSourceLastModified({ sourceName: 'Belastingdienst', fetchedAt: '2026-10-01' }), false);
  assert.equal(dateIsSourceLastModified({ sourceName: 'Rijksoverheid', fetchedAt: '2026-10-01' }), false);
  const page = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/[...slug].astro'), 'utf8');
  assert.match(page, /Deze gids is geschreven door Avydo/);
  assert.match(page, /Deze toelichting is geschreven door Avydo/);
  assert.match(page, /voor het laatst bijgewerkt op/);
});

test('geen achterhaalde relatieve tijdsaanduidingen in Rijksoverheid-samenvattingen', () => {
  for (const a of ACTIVE_RO) {
    assert.doesNotMatch(a.summary ?? '', /\b(vandaag|gisteren|morgen)\b/i, a.file);
  }
});

test('isHeadingBlock herkent tussenkoppen en geen gewone zinnen', () => {
  assert.equal(isHeadingBlock('Heldere criteria', 'Tekst.'), true);
  assert.equal(isHeadingBlock('Wat verandert er?', 'Tekst.'), true);
  assert.equal(isHeadingBlock('Heldere criteria', undefined), false);
  assert.equal(isHeadingBlock('Dit is een gewone zin.', 'Tekst.'), false);
  assert.equal(isHeadingBlock('- lijstitem', 'Tekst.'), false);
  assert.equal(isHeadingBlock('kleine letter aan het begin', 'Tekst.'), false);
  assert.equal(
    isHeadingBlock('Waarom wil het kabinet deze regeling voor zelfstandigen nu al aanpassen?', 'Tekst.'),
    false,
  );
});

test('sourceBodyBlocks: koppen, alinea’s en samengevoegde lijsten', () => {
  const blocks = sourceBodyBlocks('Eerste alinea.\n\nTussenkop\n\n- een\n- twee\n\n- drie\n\n\\- escaped streepje.');
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Eerste alinea.' },
    { type: 'heading', text: 'Tussenkop' },
    { type: 'list', items: ['een', 'twee', 'drie'] },
    { type: 'paragraph', text: '- escaped streepje.' },
  ]);
});

test('de Zelfstandigenwet-brontekst krijgt de tussenkoppen uit de bron', () => {
  const a = ACTIVE_RO.find((x) => x.file.startsWith('2026-10-01-zelfstandigenwet'));
  const headings = sourceBodyBlocks(a.body).filter((b) => b.type === 'heading').map((b) => b.text);
  assert.deepEqual(headings, ['Heldere criteria', 'Handelingsperspectief']);
});

test('weergave: geen sjabloonduiding, geen dubbele samenvatting en een juiste bronvermelding', () => {
  const card = readFileSync(path.join(ROOT, 'src/components/kenniscentrum/ArticleCard.astro'), 'utf8');
  assert.match(card, /showRelevance &&/);
  const page = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/[...slug].astro'), 'utf8');
  assert.match(page, /\{showRelevance && \(/);
  assert.match(page, /\{!showSourceText && \(/);
  assert.match(page, /Brontekst: <strong/);
  assert.match(page, /data-outdated-notice/);
  const index = readFileSync(path.join(ROOT, 'src/pages/kenniscentrum/index.astro'), 'utf8');
  assert.match(index, /data-kind-filter="nieuws"/);
  assert.match(index, /pickHighlighted\(newsArticles/);
  assert.doesNotMatch(index, /korte, eigen uitleg/);
  for (const text of [card, page, index]) {
    assert.doesNotMatch(text, />[^<{]*\b(je|jij|jou|jouw)\b[^<]*</i, 'UI-tekst in je-vorm');
  }
});
