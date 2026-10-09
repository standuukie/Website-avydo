// Regressietests voor bronlinks: geen algemene start- of rubriekpagina als
// bron, geen placeholdertitels in de bronlaag, één bronrecord per artikel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  genericSourceReason,
  isGenericSourceUrl,
  isPlaceholderSourceTitle,
  findSourceLinkIssues,
  findPlaceholderRecordTitles,
} from './source-links.mjs';
import { readSourceRecords, normalizeSourceUrl } from './source-records.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(ROOT, 'src/content/kenniscentrum');
const SOURCES_DIR = path.join(ROOT, 'src/content/bronnen');
const PENDING = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/pending-source-decisions.json'), 'utf8'));

const BD = 'https://www.belastingdienst.nl/wps/wcm/connect';

function readArticles() {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      slug: f.replace(/\.md$/, ''),
      sourceUrl: readFileSync(path.join(CONTENT_DIR, f), 'utf8').match(/^sourceUrl: "(.*)"$/m)?.[1] ?? '',
    }));
}

// --- Algemene start- en rubriekpagina's ---

test('bronlink: start- en rubriekpagina\'s van de officiële sites gelden als algemeen', () => {
  for (const url of [
    `${BD}/bldcontentnl/belastingdienst/zakelijk/`,
    `${BD}/bldcontentnl/belastingdienst/zakelijk`,
    `http://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/#top`,
    `${BD}/bldcontentnl/belastingdienst/prive/`,
    `${BD}/nl/home/home`,
    `${BD}/nl/ondernemers/ondernemers`,
    'https://www.belastingdienst.nl',
    'https://www.belastingdienst.nl/',
    'https://www.kvk.nl/deponeren/',
    'https://www.kvk.nl/starten',
    'https://www.rijksoverheid.nl/onderwerpen',
  ]) {
    assert.ok(isGenericSourceUrl(url), url);
  }
  assert.match(genericSourceReason(`${BD}/bldcontentnl/belastingdienst/zakelijk/`), /startpagina/);
  assert.match(genericSourceReason('https://www.kvk.nl/deponeren/'), /rubriekpagina/);
});

test('bronlink: specifieke pagina\'s (ook themapagina\'s over één onderwerp en nieuwsberichten) zijn niet algemeen', () => {
  for (const url of [
    `${BD}/nl/box-3/box-3`,
    `${BD}/nl/btw/content/uiterste-aangifte-en-betaaldatums`,
    `${BD}/nl/personeel-en-loon/content/werkkostenregeling`,
    `${BD}/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/tarieven_vennootschapsbelasting`,
    `${BD}/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/aanmerkelijk_belang/loon_en_aanmerkelijk_belang/`,
    `${BD}/bldcontentnl/berichten/nieuws/belastingplan-2027`,
    'https://www.kvk.nl/deponeren/jaarrekening-deponeren/',
    'https://www.rijksoverheid.nl/onderwerpen/belastingplan',
    'https://www.rijksoverheid.nl/actueel/nieuws/2023/12/11/nieuwe-overeenkomst-met-belgie-geeft-duidelijkheid-bij-thuiswerkende-werknemers',
  ]) {
    assert.equal(isGenericSourceUrl(url), false, url);
  }
});

// --- Placeholdertitels ---

test('bronrecord: placeholdertitels worden herkend, echte paginatitels niet', () => {
  assert.ok(isPlaceholderSourceTitle('Belastingdienst – geraadpleegde bronpagina', 'Belastingdienst'));
  assert.ok(isPlaceholderSourceTitle('KVK – geraadpleegde bronpagina', 'KVK'));
  assert.ok(isPlaceholderSourceTitle('KVK', 'KVK'));
  assert.ok(isPlaceholderSourceTitle('Bronpagina', 'Rijksoverheid'));
  assert.ok(isPlaceholderSourceTitle('', 'Belastingdienst'));
  assert.ok(isPlaceholderSourceTitle(undefined, 'Belastingdienst'));
  assert.equal(isPlaceholderSourceTitle('Box 3 (vermogensrendementsheffing)', 'Belastingdienst'), false);
  assert.equal(isPlaceholderSourceTitle('Jaarrekeningen deponeren', 'KVK'), false);
  assert.deepEqual(
    findPlaceholderRecordTitles([
      { id: 'a', title: 'Belastingdienst – geraadpleegde bronpagina', sourceName: 'Belastingdienst' },
      { id: 'b', title: 'Ondernemersaftrek', sourceName: 'Belastingdienst' },
    ]),
    ['a'],
  );
});

test('bronlaag: geen enkel bronrecord heeft een placeholdertitel', () => {
  assert.deepEqual(findPlaceholderRecordTitles(readSourceRecords(SOURCES_DIR)), []);
});

// --- Gedeelde bron-URL's ---

test('bronlink: meerdere artikelen op dezelfde algemene URL worden gemeld; een gedeelde specifieke bron is toegestaan', () => {
  const shared = findSourceLinkIssues([
    { slug: 'gids-a', sourceUrl: `${BD}/bldcontentnl/belastingdienst/zakelijk/` },
    { slug: 'gids-b', sourceUrl: `${BD}/bldcontentnl/belastingdienst/zakelijk` },
  ]);
  assert.deepEqual(shared.filter((i) => i.type === 'generic-url').map((i) => i.slug), ['gids-a', 'gids-b']);
  assert.deepEqual(shared.filter((i) => i.type === 'shared-generic-url').map((i) => i.slugs), [['gids-a', 'gids-b']]);

  // Een nieuwsbericht en een latere uitleg op basis van dezelfde specifieke pagina.
  const legit = findSourceLinkIssues([
    { slug: 'nieuws', sourceUrl: `${BD}/bldcontentnl/berichten/nieuws/belastingplan-2027` },
    { slug: 'uitleg', sourceUrl: `${BD}/bldcontentnl/berichten/nieuws/belastingplan-2027/` },
  ]);
  assert.deepEqual(legit, []);
});

// --- Huidige content ---

test('artikelen: geen algemene start- of rubriekpagina als bron, behalve de openstaande redactiebeslissingen', () => {
  const pending = new Set(PENDING.map((p) => p.slug));
  const issues = findSourceLinkIssues(readArticles().filter((a) => !pending.has(a.slug)));
  assert.deepEqual(issues, []);
});

test('openstaande bronkeuzes: elk item heeft een reden, bestaat nog en staat nog op een algemene URL (anders uit de lijst halen)', () => {
  const articles = new Map(readArticles().map((a) => [a.slug, a]));
  for (const p of PENDING) {
    assert.ok(p.reason && p.reason.length > 20, `${p.slug}: reden ontbreekt`);
    assert.ok(articles.has(p.slug), `${p.slug}: artikel bestaat niet meer`);
    assert.ok(isGenericSourceUrl(articles.get(p.slug).sourceUrl), `${p.slug}: heeft al een specifieke bron; haal het uit pending-source-decisions.json`);
  }
});

test('bronrelatie: elk artikel met een specifieke bron heeft precies één bronrecord dat ernaar verwijst, met dezelfde URL en een echte titel', () => {
  const records = readSourceRecords(SOURCES_DIR);
  const pending = new Set(PENDING.map((p) => p.slug));
  for (const a of readArticles()) {
    if (pending.has(a.slug)) continue;
    const linked = records.filter((r) => r.avydoSlug === a.slug);
    assert.equal(linked.length, 1, `${a.slug}: ${linked.length} bronrecords met avydoSlug`);
    assert.equal(normalizeSourceUrl(linked[0].sourceUrl), normalizeSourceUrl(a.sourceUrl), a.slug);
    assert.equal(isPlaceholderSourceTitle(linked[0].title, linked[0].sourceName), false, `${linked[0].id}: placeholdertitel`);
    assert.ok(existsSync(path.join(SOURCES_DIR, `${linked[0].id}.json`)));
  }
});

test('bronlaag: een algemene URL is nooit de gekoppelde bron van een artikel; is hij niet (meer) in gebruik, dan is het record afgewezen', () => {
  const articles = readArticles();
  for (const r of readSourceRecords(SOURCES_DIR).filter((rec) => isGenericSourceUrl(rec.sourceUrl))) {
    assert.equal(r.avydoSlug, undefined, `${r.id}: algemene URL gekoppeld aan ${r.avydoSlug}`);
    const inUse = articles.some((a) => normalizeSourceUrl(a.sourceUrl) === normalizeSourceUrl(r.sourceUrl));
    if (!inUse) assert.equal(r.processingStatus, 'afgewezen', `${r.id}: algemene URL zonder artikel moet afgewezen zijn`);
  }
});
