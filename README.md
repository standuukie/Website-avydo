# Avydo &mdash; website

Volledig herbouwde website voor Avydo Accountants & Belastingadviseurs (Venray), gebouwd met [Astro](https://astro.build) en Tailwind CSS. Statisch gegenereerd, geen backend vereist om te draaien.

## Ontwikkelen

```bash
npm install
npm run dev       # lokale dev-server
npm run build     # productie-build naar dist/
npm run preview   # preview van de build
```

## Structuur

- `src/data/` &mdash; alle content (diensten, team, testimonials, vacatures, contactgegevens) als typed data. Content aanpassen kan hier zonder de layout te raken.
- `src/components/` &mdash; herbruikbare UI-componenten.
- `src/layouts/BaseLayout.astro` &mdash; paginaskelet met SEO-tags en structured data.
- `src/pages/` &mdash; routes (bestandsgebaseerd).
- `src/content/kenniscentrum/` &mdash; de Kenniscentrum-artikelen: uitsluitend eigen Avydo-artikelen; zie hieronder.
- `src/content/bronnen/` &mdash; de bronlaag: één JSON-record per officieel bronbericht (geen pagina's).
- `scripts/kenniscentrum/` &mdash; bron-import, selectie, redactie, validatie en de bronconfiguratie voor het Kenniscentrum.
- `.github/workflows/kenniscentrum-update.yml` &mdash; de dagelijkse GitHub Actions-job die bronnen ophaalt en een redactievoorstel als Pull Request klaarzet.

## Kenniscentrum: Avydo-artikelen op basis van officiële bronnen

`/kenniscentrum` bestaat uitsluitend uit **eigen Avydo-artikelen**: Avydo legt actuele ontwikkelingen (belastingen, personeel & loon, ondernemen, wet- en regelgeving, accountancy) uit voor Nederlandse mkb-ondernemers. Elk artikel is gebaseerd op één officiële bron (Belastingdienst, Rijksoverheid of KVK) en verwijst daarnaar (`sourceName`/`sourceUrl`). Een officieel bronbericht wordt nooit meer rechtstreeks als artikel gepubliceerd.

### Architectuur

```
officiële bronnen (Belastingdienst RSS, Rijksoverheid topic-API, KVK-sitemaps)
   -> scripts/kenniscentrum/fetch-articles.mjs     bron-ingestie + relevantiefilters
   -> src/content/bronnen/*.json                   bronlaag (verwerkingsstatus per bron)
   -> scripts/kenniscentrum/select-topics.mjs      max. 2 onderwerpen per dag (0 mag)
   -> scripts/kenniscentrum/editorial.mjs          Avydo-artikel via AI (vaste tool + JSON-schema)
   -> scripts/kenniscentrum/validate-article.mjs   vaste controles (feiten, status, titel, overlap, bron)
   -> src/content/kenniscentrum/*.md               Avydo-artikel (avydoContent: toelichting/gids)
   -> tests + build -> Pull Request (menselijke controle) -> merge -> Vercel deployt
```

De dagelijkse GitHub Actions workflow (`.github/workflows/kenniscentrum-update.yml`, ook handmatig via "Run workflow") pusht **nooit** rechtstreeks naar de live branch. Alleen als er een gevalideerd Avydo-artikel is, komt er een Pull Request met het onderwerp, de officiële bron, de reden van selectie, de status en het validatieresultaat. Geen geschikt onderwerp, of mislukte generatie/validatie: geen Pull Request; de reden staat in de job summary.

**Bronlaag** (`src/content/bronnen/`, Astro data-collectie `bronnen`, schema in `src/content/config.ts`): per bron `sourceUrl`, `sourceName`, brontitel, omschrijving, opgehaalde hoofdtekst (`body`), `sourcePublishedAt` of (KVK) `sourceLastModified`, `fetchedAt`, `processingStatus` (`kandidaat`/`verwerkt`/`afgewezen`), `rejectionReason` en `avydoSlug`. `sourceUrl` (genormaliseerd: https, geen trailing slash) is de sleutel voor deduplicatie; een bron die in de bronlaag of in een artikel staat, wordt niet opnieuw geïmporteerd. Bron → artikel via `avydoSlug` of dezelfde `sourceUrl`; artikel → bron via `sourceUrl`.

**Selectie** (`select-topics.mjs`): 1) actueel nieuws (Belastingdienst/Rijksoverheid, ≤ 14 dagen), 2) nieuwe of aangekondigde regelgeving (wetgevingssignaal én recent of met een toekomstige ingangsdatum in de bron), 3) blijvende uitleg (KVK, alleen op een dag zonder 1/2, hooguit één). Een KVK-`lastmod` telt nooit als nieuwsdatum. Afgewezen wordt: te weinig brontekst, overlap met een bestaand Avydo-artikel (titel-Jaccard, geen embeddings), bron al verwerkt, of al in een open/gesloten redactie-PR.

**Datums**: `publishedAt` is de publicatiedatum van het Avydo-artikel, `sourcePublishedAt` die van het bronbericht. Bij de 55 in oktober 2026 omgezette artikelen is `publishedAt` gelijk gebleven aan de brondatum (de AI-assistent gebruikt `publishedAt` als brondatum in zijn context); de omzetting staat in `updatedAt`.

### Gebruikte bronnen

Zie `scripts/kenniscentrum/sources.config.mjs` voor de volledige, becommentarieerde lijst. Op dit moment:

| Bron | Type | Bron-URL | Categorie |
|---|---|---|---|
| Belastingdienst (Actueel zakelijk) | RSS | `nieuwsfeed_actueel_zakelijk.xml` | Belastingen |
| Rijksoverheid | Topic-API (`POST /api/search`), 12 geselecteerde topics | `rijksoverheid.nl/api/search` | gemengd (streng gefilterd op fiscale/accountancy-trefwoorden; Financiën-publicaties met een fiscale stam tellen mee; alleen artikelen van maximaal 24 maanden oud) |
| KVK | `sitemap_index.xml` &rarr; `documents-*.xml` | `kvk.nl/sitemap_index.xml` | kennisartikelen, redactioneel gefilterd (zie `classifyKvkRelevance`) |

Elke bron heeft een `urlConfidence`-veld: `confirmed` betekent dat de exacte URL rechtstreeks live is getest (niet via een zoekmachine); `inferred` betekent dat de URL een bevestigd patroon volgt maar niet 1-op-1 live is geverifieerd. Het ophaalscript controleert dit bij elke run zelf: een niet-bereikbare of ongeldige feed/sitemap wordt overgeslagen (nooit verzonnen), en de uitkomst per bron — inclusief de stadia *opgehaald → geparsed → relevant → vastgelegd (in de bronlaag)* — is zichtbaar in de samenvatting van elke workflow-run (tab **Actions** &rarr; run &rarr; "Summary") en in de jobs-log.

**Bron-types** (veld `type` in `sources.config.mjs`):
- `rss`: een RSS/Atom-feed met title/link/description/pubDate per item.
- `sitemap`: een Google News-sitemap (`xmlns:news`), die alleen recente artikelen bevat (titel, publicatiedatum, canonieke URL) zonder samenvattingstekst. Voor elk nieuw artikel wordt de paginabron zelf opgehaald om de `meta description`/`og:description` te lezen als brontekst voor de samenvatting. Momenteel door geen actieve bron gebruikt.
- `rijksoverheid-topic-api`: de Rijksoverheid-bron. Kandidaat-URL's komen per geconfigureerd topic uit de topic-API van rijksoverheid.nl; daarna wordt per nieuw artikel de paginabron opgehaald (titel, samenvatting en de breadcrumb-link naar `/ministeries/<slug>`, waarmee fiscale publicaties van Financiën als relevant tellen, ook zonder trefwoordtreffer — `ministryBypass`-veld).

**Waarom Rijksoverheid de topic-API gebruikt in plaats van RSS**: rijksoverheid.nl is medio 2026 overgestapt op een nieuw technisch platform, waarbij de oude RSS-infrastructuur op `feeds.rijksoverheid.nl` buiten gebruik is geraakt (het domein resolvet niet meer). Een sitewide sitemap-aanpak leverde vrijwel alleen niet-relevant overheidsnieuws op en is verwijderd; de topic-API beperkt de kandidaten tot 12 bewust voor Avydo geselecteerde onderwerpen (zie `sources.config.mjs`).

Om te voorkomen dat één bron structureel (bijna) alle artikelen levert, geldt naast het totale `maxArticlesPerRun` ook een `maxArticlesPerSourcePerRun`-plafond per bron per run.

**Onderzocht maar niet geïntegreerd** (elk daadwerkelijk live getest, niet via een zoekmachine of giswerk — zie de uitgebreide toelichting in `sources.config.mjs`):
- **KVK-nieuwsoverzicht** (`kvk.nl/overzicht/`): geen RSS; de pagina haalt content client-side op bij een intern CMS-endpoint. KVK-kennisartikelen komen daarom via de publieke sitemaps binnen (zie hierboven).
- **NBA** (`nba.nl/nieuws/`): geen RSS, de sitemap bevat geen individuele nieuwsartikelen, en de indexpagina levert geen server-gerenderde links op om te parsen.
- **FD** (`fd.nl/economie`): heeft een technisch werkende RSS-feed, maar zowel de feed zelf ("intended solely for personal, non-commercial use") als `fd.nl/robots.txt` ("Prohibited uses include... any commercial purposes") sluiten gebruik op een commerciële website expliciet uit. Een juridische, geen technische blokkade.
- **Gemeente Venray** (`venray.nl/nieuwsoverzicht`): geen RSS of nieuws-specifieke sitemap (de algemene sitemap maakt geen onderscheid tussen nieuwsartikelen en statische pagina's), en de bot-bescherming van de site blokkeerde herhaaldelijk verzoeken, ook met een browser-useragent.

### Bronnen toevoegen, verwijderen of aan/uitzetten

Open `scripts/kenniscentrum/sources.config.mjs`:

- Nieuwe bron toevoegen: nieuw object toevoegen aan de `sources`-array (id, naam, `type: 'rss'` met `feedUrl`, of `type: 'sitemap'` met `sitemapUrl`, plus `defaultCategory`, `enabled: true`).
- Bron tijdelijk uitzetten: `enabled: false` zetten (bestaande artikelen van die bron blijven gewoon staan).
- Trefwoorden per categorie of "belangrijk"-signalen aanpassen: `categoryKeywords` / `importantKeywords` in hetzelfde bestand.

### Een artikel handmatig beheren

Elk artikel is een los markdown-bestand in `src/content/kenniscentrum/`, met leesbare frontmatter. Geen CMS nodig:

- **Redactievoorstel beoordelen**: de Pull Request van de dagelijkse run nalezen, eventueel aanpassen en mergen; sluiten zonder merge = afwijzen (die bron wordt niet opnieuw voorgesteld).
- **Verwijderen**: het bestand verwijderen. Laat het bronrecord in `src/content/bronnen/` staan (zet het op `afgewezen` met een reden), zodat de bron niet opnieuw wordt geïmporteerd.
- **Verbergen**: `hidden: true` zetten in de frontmatter.
- **Uitlichten** (bovenaan als "Uitgelicht"): `featured: true` zetten.
- **Status**: `status` (`voorstel`, `consultatie`, `voornemen`, `aangenomen`, `van-kracht`, `historisch`, `herzien`, `deels-geschrapt`) en zo nodig `supersededBy` (sourceUrl van het opvolgende artikel).

### Avydo-artikel genereren (AI)

De redactiestap (`editorial.mjs`) roept de Anthropic API aan met een verplichte tool en een JSON-schema (titel, samenvatting, tekst met tussenkoppen, duiding, status, categorie, doelgroepen, tags) en de volledige opgehaalde brontekst. Het model is in te stellen met `KENNISCENTRUM_MODEL`. De prompt verbiedt informatie die niet in de bron staat; bij te weinig broninformatie levert het model geen artikel. Daarna controleert `validate-article.mjs` zonder AI onder meer: officiële en bereikbare bron, eigen titel (niet de brontitel), voldoende tekst en tussenkoppen, bedragen/percentages/datums/jaartallen die in de bron voorkomen, een voorstel niet als geldende regel, een toekomstige datum niet als al geldend, geldige status en geen overlap met bestaande Avydo-artikelen. Eén fout = geen artikel en geen Pull Request.

Zonder `ANTHROPIC_API_KEY` worden alleen bronrecords vastgelegd en ontstaat er geen artikel. Hoofdtekst wordt opgehaald voor Rijksoverheid (vaste tekstmarkers) en voor Belastingdienst/KVK (het `<main>`-element van de bronpagina); lukt dat niet betrouwbaar, dan komt de bron niet in aanmerking voor een artikel.

### Environment variables

| Variabele | Verplicht | Waar instellen | Doel |
|---|---|---|---|
| `GEMINI_API_KEY` | Nee (aanbevolen) | Vercel &rarr; Project Settings &rarr; Environment Variables | Primaire, gratis AI-provider voor de AI-assistent (`/kenniscentrum/ai-assistent`). Zie "Kenniscentrum: AI-assistent" hieronder. |
| `GROQ_API_KEY` | Nee (aanbevolen) | Vercel &rarr; Project Settings &rarr; Environment Variables | Secundaire, gratis fallback-provider voor de AI-assistent. |
| `AI_PROVIDER` | Nee | Vercel &rarr; Project Settings &rarr; Environment Variables | Kiest de providerketen (`free` = standaard). Zie "Provider-configuratie" hieronder. |
| `ANTHROPIC_API_KEY` | Nee | GitHub &rarr; repository Secrets (Actions) **én/of** Vercel &rarr; Project Settings &rarr; Environment Variables | In GitHub Actions: nodig om dagelijks een Avydo-artikel te laten schrijven. Op Vercel (alleen bij expliciete `AI_PROVIDER=anthropic`/`free-with-paid-fallback`): een optionele, betaalde provider voor de AI-assistent. |

Alle sleutels worden uitsluitend server-side gebruikt:
- `ANTHROPIC_API_KEY` in GitHub Actions (workflow "Kenniscentrum bijwerken") voor de redactiestap. Zonder deze key worden alleen bronnen vastgelegd en komt er geen redactievoorstel.
- `GEMINI_API_KEY`/`GROQ_API_KEY`/`ANTHROPIC_API_KEY` op Vercel, gelezen door `src/pages/api/kenniscentrum-chat.ts` en `src/lib/ai-providers/` (een serverless function, zie hieronder) voor de AI-assistent. **Zonder minstens één geldige sleutel op Vercel toont de assistent een nette "momenteel niet beschikbaar"-melding** in plaats van te crashen; de rest van de website blijft gewoon werken.

Sleutels staan nergens in de frontend of in git &mdash; alleen als secret/environment variable, alleen server-side gelezen. Dit is na implementatie expliciet gecontroleerd door de volledige Vercel build-output te doorzoeken op de sleutelnamen en provider-domeinen: die komen alleen voor in de servergebundelde function, nooit in de statische client-bundels.

### Fallback en betrouwbaarheid

- Iedere bron wordt los geprobeerd (try/catch); een niet-bereikbare of ongeldige feed/sitemap stopt de andere bronnen niet.
- Er wordt nooit content verzonnen: zonder voldoende broninformatie wordt een bron overgeslagen of niet gekozen, en de vaste validatie houdt artikelen met feiten buiten de bron tegen.
- De workflow faalt nooit hard op een bronprobleem (exit code altijd 0) &mdash; anders zou een tijdelijk offline feed onterecht een rode kruis in GitHub Actions veroorzaken.
- Omdat artikelen gewone, gecommitte bestanden zijn, is de site nooit leeg of stuk door een tijdelijk niet-beschikbare bron. Nieuwe artikelen komen pas live na een gemergde Pull Request.
- Is de collectie nog helemaal leeg (bijvoorbeeld vóór de eerste run), dan toont `/kenniscentrum` een nette "binnenkort"-melding in plaats van een lege of kapotte pagina.

### Kosten

- GitHub Actions: gratis binnen de standaard minutenlimiet van deze repository (de job duurt typisch enkele seconden tot een minuut per run).
- Bronnen: gratis, publieke overheidsfeeds en -sitemaps.
- AI: hooguit twee aanroepen per dag (één per gekozen onderwerp), alleen bij gezette `ANTHROPIC_API_KEY`.
- Geen betaalde nieuws-API's of zoekdiensten gebruikt.

### Handmatig een run starten

GitHub &rarr; tab **Actions** &rarr; workflow "Kenniscentrum bijwerken" &rarr; **Run workflow**. Of lokaal: `npm run kenniscentrum:fetch` (schrijft bronrecords naar `src/content/bronnen/` en, met `ANTHROPIC_API_KEY`, een gevalideerd artikel naar `src/content/kenniscentrum/`; lokaal komt er geen Pull Request).

Let op: voor het aanmaken van Pull Requests moet in GitHub &rarr; Settings &rarr; Actions &rarr; General de optie "Allow GitHub Actions to create and approve pull requests" aan staan.

## Kenniscentrum: AI-assistent

`/kenniscentrum/ai-assistent` is een chatinterface waarmee bezoekers vragen kunnen stellen over belastingen, accountancy en ondernemen. Vanaf een artikelpagina kan via "Vraag het aan onze AI-assistent" ook een vraag over dát specifieke artikel gesteld worden (`?artikel=<slug>`).

### Architectuur (RAG, geen los model)

De assistent verzint nooit zelf fiscale feiten. Elke vraag doorloopt:

1. **Retrieval** (`src/lib/ai-assistent.ts`, `retrieveContext()`): een lichte, trefwoord-gebaseerde zoekfunctie over de **bestaande** databronnen &mdash; de Avydo AI-kennisbank (`src/data/ai-knowledge/`, zie hieronder), de Kenniscentrum-contentcollectie (`getCollection('kenniscentrum')`), de Belastingkalender-dataset (`src/data/belastingkalender.ts`) en een klein stukje Avydo-contactinformatie. Er is bewust **geen** aparte nieuws- of vectordatabase toegevoegd.
2. De gevonden bronnen (elk met een echte, al bestaande URL) worden als genummerde lijst meegegeven aan het taalmodel.
3. Het model antwoordt via een **gedwongen tool-call** (structured output, geen vrije tekst) met velden als `kortAntwoord`, `toelichting`, `letOp`, `gebruikteBronIds`, `onvoldoendeInformatie` en `verwijstNaarPersoonlijkAdvies`.
4. **Server-side validatie**: elke `gebruikteBronIds`-verwijzing die niet in de daadwerkelijk opgehaalde bronnenlijst voorkomt, wordt genegeerd. Zo kan een verzonnen bron of URL nooit bij de bezoeker terechtkomen. `onvoldoendeInformatie` wordt server-side geforceerd op `true` in twee gevallen, ongeacht wat het model zelf teruggeeft: als er helemaal geen bronnen gevonden zijn, **of** als het antwoord geen enkele bron citeert terwijl er wel bronnen beschikbaar waren (zie het incident hieronder).

De volledige systeemprompt (stijl, brongebruik, privacy/veiligheidsregels) staat in `src/pages/api/kenniscentrum-chat.ts`.

#### Incident: antwoord op "bedrijf starten" verscheen soms zonder bronvermelding

Bij het testen van de antwoordkwaliteit (zie de inhoudelijke verbeterronde in de commit-historie) bleek het antwoord op "Ik wil binnenkort een bedrijf starten. Wat moet ik allemaal regelen?" soms zonder de verplichte bronvermelding te verschijnen. Onderzoek van de retrieval-laag toonde aan dat dit **niet** kwam doordat er geen relevante bronnen werden gevonden: voor deze exacte vraag matchen meerdere kennisitems (`onderneming-starten`, `vof-en-maatschap`, `fiscale-gevolgen-starten`) met een ruim voldoende score, en die worden ook daadwerkelijk aan het model meegegeven. De oorzaak lag dus bij de modelgeneratie: het taalmodel beantwoordde deze brede, samengestelde vraag kennelijk soms zonder de meegegeven bronnen te citeren in `gebruikteBronIds`, ook al gebruikte het (vermoedelijk) wel de inhoud ervan of een eigen algemene formulering.

Twee maatregelen lossen dit op:
1. **Systeemprompt aangescherpt** (`buildSystemPrompt()`): een expliciete, dwingende regel dat elk gebruikt bronnummer in `gebruikteBronIds` moet staan, en dat dit ook geldt wanneer meerdere bronnen voor verschillende deelonderwerpen van één antwoord gebruikt zijn (relevant bij precies dit soort brede "wat moet ik allemaal regelen"-vragen).
2. **Server-side vangnet** (`kenniscentrum-chat.ts`): als er bronnen gevonden zijn, het model zelf niet aangeeft dat de informatie onvoldoende is, maar het antwoord toch geen enkele bron citeert, wordt dit nu serverside behandeld als `onvoldoendeInformatie = true`. Bij correct modelgedrag verandert dit niets (een antwoord dat terecht geen bron citeert, zou dat sowieso al zelf aangeven); het vangt alleen de situatie op waarin het model een ogenschijnlijk zelfverzekerd antwoord geeft zonder brontoewijzing.

Dit kon niet live tegen Groq worden geverifieerd (geen netwerktoegang tot `api.groq.com` vanuit deze ontwikkelomgeving); de retrieval-kant is wel bevestigd via de automatische tests (zie hieronder), en de serverside-logicawijziging is een pure, makkelijk te redeneren toevoeging aan bestaande validatielogica.

### Avydo AI-kennisbank (`src/data/ai-knowledge/`)

Naast de Kenniscentrum-nieuwsartikelen (actueel, tijdgebonden) en de Belastingkalender (deadlines) bevat `src/data/ai-knowledge/` een **statische, versiebeheerde kennisbank** met bijna 50 algemene, veelgevraagde onderwerpen voor Nederlandse ondernemers en mkb-klanten van Avydo &mdash; bijvoorbeeld rechtsvormen, btw, de KOR, inkomsten- en vennootschapsbelasting, de DGA, personeel (inclusief arbeidsovereenkomst, pensioen en arbeidsomstandigheden) en bedrijfsverzekeringen. Dit maakt het mogelijk dat de assistent ook evergreen "wat is..."/"wanneer moet ik..."-vragen goed beantwoordt, niet alleen vragen die toevallig aansluiten bij een recent nieuwsartikel.

**Structuur**: per onderwerpcluster één bestand (`ondernemingsvormen.ts`, `administratie.ts`, `btw.ts`, `inkomstenbelasting.ts`, `bv-dga.ts`, `personeel.ts`), elk een array van `KnowledgeItem` (zie `types.ts`), gebundeld in `index.ts` tot één `knowledgeBase`-array. Elk item bevat: `id`, `title`, `category`, `content`, `targetAudience`, `sourceName`, `sourceUrl`, `lastVerified`, `tags`, `priority`.

**Bronnen**: uitsluitend Belastingdienst, KVK/Ondernemersplein en Rijksoverheid (en waar relevant de NBA) &mdash; nooit blogs of andere secundaire bronnen. Elke `sourceUrl` is een daadwerkelijk gecontroleerde, bestaande pagina; er wordt nooit een URL verzonnen. Dit wordt automatisch getoetst door een test (zie hieronder).

**Actualiteit**: de `content`-velden geven bewust **geen** belastingtarieven, drempelbedragen, percentages of deadlines &mdash; die wijzigen regelmatig en zouden verouderd kunnen raken zonder dat dit opvalt. In plaats daarvan legt `content` uit *hoe* iets werkt, en verwijst voor actuele cijfers naar `sourceUrl`. `lastVerified` (YYYY-MM-DD) registreert wanneer de content en URL voor het laatst gecontroleerd zijn; controleer dit periodiek opnieuw (bijvoorbeeld jaarlijks, of zodra een bezoeker een verouderd antwoord signaleert) en werk de datum bij na controle.

**Een nieuw kennisitem toevoegen**: open het best passende bestand in `src/data/ai-knowledge/` (of maak een nieuw bestand met hetzelfde patroon, bijv. `subsidies.ts`), voeg een object toe dat voldoet aan `KnowledgeItem`, en importeer/spreid een nieuw bestand in `index.ts`. Er is verder **niets** aan te passen aan de retrieval of de RAG-integratie: elk item in `knowledgeBase` wordt automatisch meegenomen. Zie de uitgebreide toelichting bovenaan `src/data/ai-knowledge/index.ts`.

**Retrieval**: `src/lib/knowledge-match.mjs` bevat de eigenlijke matchinglogica (`tokenize`, `overlapScore`, `retrieveKnowledgeItems`) &mdash; bewust een los, framework-onafhankelijk `.mjs`-bestand (geen `astro:content`-afhankelijkheid) zodat dezelfde, echte matchinglogica zowel door `ai-assistent.ts` (productie) als rechtstreeks door `npm run kenniscentrum:test` (`scripts/kenniscentrum/knowledge-retrieval.test.mjs`) gebruikt wordt, zonder dat daar een extra testdependency (ts-node/vitest) voor nodig is. Titel en tags wegen zwaarder mee dan de lopende tekst; een item scoort alleen mee bij minstens één trefwoordtreffer, en per vraag worden maximaal 3 kennisitems meegegeven aan het taalmodel (naast de bestaande limieten voor artikelen en deadlines) om de context compact te houden.

**Persoonlijk advies**: kennisitems bevatten uitsluitend algemene, feitelijke uitleg. Of een specifieke vraag persoonlijk fiscaal advies vereist (bijvoorbeeld "welke rechtsvorm moet ík kiezen") wordt niet per kennisitem bepaald, maar door de systeemprompt in `kenniscentrum-chat.ts` (`verwijstNaarPersoonlijkAdvies`) &mdash; zo blijft dit onderscheid consistent, ongeacht welke bron(nen) voor een antwoord gebruikt zijn.

### Gebruikte AI-provider(s): gratis-eerst, providerneutraal

De AI-assistent gebruikt **standaard uitsluitend gratis AI-providers**, zonder creditcard, via een kleine provider-abstractielaag in `src/lib/ai-providers/`:

| Provider | Rol | Model (standaard) | Env-var(s) |
|---|---|---|---|
| **Groq** | Primair (standaard) | `openai/gpt-oss-20b` | `GROQ_API_KEY`, optioneel `GROQ_MODEL` |
| **Google Gemini** | Beschikbaar, **niet in de standaardketen** (zie incident hieronder) | `gemini-flash-latest` (officiële Google-alias) | `GEMINI_API_KEY`, optioneel `GEMINI_MODEL` |
| **Anthropic Claude** | Optioneel, **standaard uitgeschakeld** | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY`, optioneel `ANTHROPIC_MODEL` |

#### Incident (25-9-2026): "De assistent kon nu niet antwoorden" na het toevoegen van GEMINI_API_KEY

Na het toevoegen van `GEMINI_API_KEY` op Vercel bleef de assistent deze foutmelding geven. Onderzoek (zie ook de code-comments in `src/lib/ai-providers/gemini.ts` en `index.ts`) wees uit dat de **technische integratie zelf correct is**, maar dat Gemini's gratis tier voor déze specifieke toepassing niet gebruikt mag worden:

- **Requestopbouw geverifieerd**: een live testaanroep (met een bewust ongeldige sleutel) naar `generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent` met de `x-goog-api-key`-header gaf de specifieke fout `API_KEY_INVALID` terug — geen route-, model- of schemafout. Endpoint, modelalias en tool-schema kloppen dus tegen de echte, actuele API.
- **Nieuwe sleutelformaat gecontroleerd**: Google migreert sinds mei 2026 naar "auth keys" (`AQ.Ab…`, i.p.v. het oude `AIzaSy…`-formaat) en accepteert sinds september 2026 geen oude "standard keys" meer. Beide sleuteltypes gebruiken echter dezelfde `x-goog-api-key`-header (nooit `?key=` in de URL) — onze requestmethode was hier al mee compatibel, dit was niet de oorzaak.
- **Structured output/function calling gecontroleerd**: ons tool-schema gebruikt uitsluitend `type`/`properties`/`items`/`required` — geen van de velden waarvan bekend is dat Gemini ze afwijst (`$ref`, `$schema`, `exclusiveMinimum`/`exclusiveMaximum`, type-arrays). Ook hier geen probleem gevonden.
- **Waarschijnlijke daadwerkelijke oorzaak**: Google's *Gemini API Additional Terms of Service* staan het gebruik van de **gratis** tier alleen toe wanneer de applicatie geen gebruikers bedient in de Europese Economische Ruimte (EER), Zwitserland of het Verenigd Koninkrijk — letterlijk: *"You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."* (bron: [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms); actief besproken op Google's eigen AI Developer Forum). Avydo bedient Nederlandse mkb-ondernemers — per definitie EER-gebruikers. Dat betekent dat de gratis Gemini-tier voor deze website contractueel niet is toegestaan, ongeacht of de sleutel en het verzoek verder technisch correct zijn; Google kan verzoeken vanuit een in Nederland geregistreerd AI Studio-project daardoor weigeren of beperken (doorgaans als een 403/permissie-achtige fout op accountniveau).

**Doorgevoerde fix**: Gemini is uit de **standaard** providerketen gehaald. `AI_PROVIDER=free` (de standaardwaarde) gebruikt nu uitsluitend **Groq** — een gratis provider die de EER wél bedient onder zijn eigen voorwaarden (via Groq UK Limited voor EER/CH-klanten), zonder deze beperking. De Gemini-adapter zelf is **niet verwijderd**: hij blijft volledig werkend en bruikbaar via een expliciete keuze (zie hieronder) voor wie Google Cloud Billing inschakelt op het AI Studio-project — dat maakt het gebruik een *Paid Service*, waarmee de EER-beperking vervalt (en als bijkomend voordeel: Google gebruikt de gegevens dan niet meer om producten te verbeteren). Bij dit gebruiksvolume blijft dat doorgaans nog steeds vrijwel gratis, ook al is het technisch geen "gratis tier" meer.

**Wat u eventueel nog moet doen**: niets verplicht — de assistent werkt nu met alleen `GROQ_API_KEY`. `GEMINI_API_KEY` mag desgewenst in Vercel blijven staan (wordt gewoon genegeerd in de standaardconfiguratie) of verwijderd worden. Wilt u Gemini alsnog gebruiken, schakel dan Google Cloud Billing in op het betreffende AI Studio-project en zet `AI_PROVIDER=gemini`.

#### Incident (28-9-2026): dezelfde melding bleef verschijnen ná het toevoegen van GROQ_API_KEY

Na het toevoegen van `GROQ_API_KEY` en een nieuwe deployment bleef exact dezelfde foutmelding komen. Volledige request-flow doorlopen (rate limiter → `retrieveContext()` → providerketen → Groq-aanroep):

- **API-route en rate limiter**: geen probleem. De route wordt aangeroepen zoals verwacht; bij één testvraag wordt de limiet (12/IP per 5 min, 20 globaal per minuut) niet geraakt.
- **`retrieveContext()` / RAG-laag**: geen probleem voor de geteste vragen. "Wanneer moet ik btw-aangifte doen?", "Wat is het verschil tussen een eenmanszaak en een bv?", "Wat is de KOR?" en "Wat doet een accountant?" matchen allemaal op bestaande Kenniscentrum-artikelen en/of Belastingkalender-deadlines via de trefwoord-overlap in `src/lib/ai-assistent.ts` — er is dus voldoende brondekking, dit is geen RAG-beperking.
- **`GROQ_API_KEY` gevonden en Groq daadwerkelijk aangeroepen**: ja. De foutmelding die de gebruiker ziet ("De assistent kon nu niet antwoorden…") komt specifiek uit de `upstream_error`-tak (HTTP 502) in `kenniscentrum-chat.ts`, die alléén optreedt wanneer `attempted.length > 0` — d.w.z. er is minstens één provider daadwerkelijk geprobeerd én mislukt. Was `GROQ_API_KEY` niet gevonden, dan zou de gebruiker de andere melding zien ("De AI-assistent is momenteel niet beschikbaar", HTTP 503/`not_configured`). Dit bevestigt dat de sleutel wordt gevonden en Groq wordt aangeroepen, maar dat de aanroep zelf faalt.
- **Exacte fout van Groq**: het toenmalige standaardmodel `llama-3.3-70b-versatile` is door Groq **gedecommissioneerd op 16-8-2026** (aangekondigd 17-6-2026, samen met `llama-3.1-8b-instant`). Sinds die datum geeft Groq op elk verzoek met dit modelnaam een `404`-fout terug: *"The model llama-3.3-70b-versatile does not exist or you do not have access to it."* Dit is bevestigd via meerdere onafhankelijke bronnen (Groq's eigen deprecations-pagina, meerdere GitHub-issues van andere projecten die tegen exact dezelfde fout aanliepen, en het model-metadatabestand van het LiteLLM-project waarin dit model niet meer voorkomt). Live end-to-end verificatie tegen `api.groq.com` zelf kon vanuit deze ontwikkelomgeving niet worden uitgevoerd (uitgaand verkeer naar dat domein wordt hier geblokkeerd door de sandbox-netwerkpolicy) — de conclusie steunt op de hierboven genoemde onafhankelijke bronnen, niet op een eigen live-test.
- **Technisch vs. RAG-beperking**: dit is puur technisch (een niet meer bestaand modelnaam), geen beperking van de kennisbank — voor alle vier de testvragen was voldoende bronmateriaal beschikbaar.
- **AI_PROVIDER-instelling**: in de code staat de standaardketen onveranderd op `[groq]` (zie `resolveProviderChain()` in `index.ts`); wat er in Vercel voor `AI_PROVIDER` staat kon vanuit deze omgeving niet worden gecontroleerd (geen Vercel-toegang) — controleer dit zelf in Vercel → Project → Settings → Environment Variables als de fout na onderstaande fix onverhoopt aanhoudt.

**Doorgevoerde fix**: het standaardmodel in `src/lib/ai-providers/groq.ts` is gewijzigd van het gedecommissioneerde `llama-3.3-70b-versatile` naar `openai/gpt-oss-20b` — een actueel, door Groq ondersteund model dat function calling/`tool_choice` ondersteunt en (op het moment van schrijven, door meerdere bronnen bevestigd) onderdeel is van Groq's gratis, creditcard-loze tier. Groq's eigen aanbevolen vervanger is het grotere `openai/gpt-oss-120b`; daar is hier bewust niet voor gekozen omdat over de gratis-status daarvan tegenstrijdige informatie bestond op het moment van onderzoek — zie de code-comment in `groq.ts` voor hoe dit in de toekomst te verifiëren via console.groq.com/docs/models en /docs/deprecations.

**Wat u nog moet doen**: test de assistent na deze deployment opnieuw met de vier bovenstaande vragen. Mocht de melding onverhoopt blijven verschijnen, controleer dan in Vercel → Deployments → de nieuwste deployment → Functions → Logs op de regel `[kenniscentrum-chat] provider "groq" faalde: …` — die bevat de exacte HTTP-status en foutmelding van Groq (nooit de sleutel zelf) en verwijst direct naar de oorzaak (bijv. een ongeldige sleutel, een opnieuw gewijzigd modelnaam, of een quotum-fout).

**Waarom Groq als (nu primaire) keuze** (vergeleken met Gemini, OpenRouter en Vercel AI Gateway, onderzocht september 2026): daadwerkelijk gratis zonder creditcard, met eigen, modelafhankelijke limieten (orde van grootte 30 requests/minuut; zie [console.groq.com](https://console.groq.com/docs/rate-limits) voor de actuele cijfers per model), bedient EER-klanten onder zijn eigen voorwaarden, en ondersteunt een gedwongen `tool_choice` voor dezelfde betrouwbare structured-outputgarantie als eerder bij Anthropic.

**Waarom niet OpenRouter**: de gratis modellen daar zijn beperkt tot 20 requests/minuut én slechts 50 requests/dag (zonder ooit een creditcard toegevoegd te hebben), en de beschikbare gratis modellen wisselen periodiek &mdash; te instabiel en te krap voor een publieke pagina.
**Waarom niet Vercel AI Gateway**: geeft $5 gratis krediet per maand, maar is daarmee een *krediet met een bodem* in plaats van een onvoorwaardelijk gratis tier; bij uitputting zou dit (afhankelijk van de Vercel-projectinstellingen) kunnen doorlopen in betaald verbruik, wat afwijkt van de "nooit ongemerkt kosten"-eis van dit project.

Alle providers worden aangeroepen met een rechtstreekse `fetch` (geen extra SDK-dependency), op dezelfde manier als de bestaande Anthropic-integratie dat al deed.

### Provider-configuratie (`AI_PROVIDER`)

```
AI_PROVIDER=free                     # standaard (ook als de variabele ontbreekt): alleen Groq, nooit betaald
AI_PROVIDER=free-with-paid-fallback  # Groq → Anthropic als allerlaatste, betaald redmiddel
AI_PROVIDER=gemini                   # alleen Gemini (bv. na het inschakelen van Google Cloud Billing)
AI_PROVIDER=groq                     # alleen Groq (gelijk aan de standaard)
AI_PROVIDER=anthropic                # alleen Anthropic
```

Een onbekende of lege waarde valt altijd terug op de veilige standaard (`free`). De keten wordt bepaald in `src/lib/ai-providers/index.ts` (`resolveProviderChain()`); elke provider daarin is een losstaande adapter die dezelfde `AiProvider`-interface implementeert (`src/lib/ai-providers/types.ts`), zodat een nieuwe provider toevoegen of de standaardkeuze wijzigen geen wijzigingen elders vereist (retrieval, promptopbouw, brontoewijzing-validatie en de frontend blijven ongewijzigd, ongeacht welke provider actief is).

**Bestaande Anthropic-integratie is behouden, niet verwijderd** &mdash; alleen verplaatst naar `src/lib/ai-providers/anthropic.ts` en niet meer standaard actief. Wie later (weer) naar Anthropic wil overschakelen, zet `AI_PROVIDER=anthropic` (of `free-with-paid-fallback`) en de bestaande `ANTHROPIC_API_KEY`.

### Diagnose bij een "kon niet antwoorden"-melding

`src/lib/ai-providers/index.ts` logt bij elke mislukte poging een veilige regel naar de servelogs (Vercel &rarr; project &rarr; Deployments &rarr; de betreffende deployment &rarr; Functions &rarr; Logs, of `vercel logs`): de provider-id plus de HTTP-status en (ingekorte) responstekst van de provider zelf &mdash; **nooit** de API-sleutel. Bij "geen enkele provider geconfigureerd" logt het bovendien of `GEMINI_API_KEY`/`GROQ_API_KEY`/`ANTHROPIC_API_KEY` als aanwezig herkend worden (alleen `true`/`false`), zodat direct zichtbaar is of een sleutel simpelweg ontbreekt, verkeerd genoemd is, of in de verkeerde Vercel-omgeving (Preview i.p.v. Production) staat.

### Serverless architectuur op Vercel

De site is en blijft grotendeels **statisch** (`output: 'hybrid'` in `astro.config.mjs`): alle bestaande pagina's worden nog steeds als statische HTML gebouwd, precies zoals voorheen. Alleen `src/pages/api/kenniscentrum-chat.ts` heeft `export const prerender = false` en draait als Vercel serverless function (via de `@astrojs/vercel/serverless`-adapter), omdat die route provider-sleutels server-side nodig heeft en dus niet vooraf gebouwd kan worden. Alle sleutels worden uitsluitend binnen deze route en de providers in `src/lib/ai-providers/` gelezen (`import.meta.env.*`) en komen nooit in de browser of in de HTML terecht &mdash; de frontend praat alleen met `/api/kenniscentrum-chat`, nooit rechtstreeks met Gemini, Groq of Anthropic. Dit is expliciet gecontroleerd door de volledige build-output te doorzoeken: geen van de sleutelnamen of provider-domeinen komt voor in `.vercel/output/static/` (de client-bundels), alleen in de servergebundelde functie.

Lokaal testen van de API-route kan met `npm run dev` (Astro's eigen dev-server voert server-routes direct uit); `npm run preview` serveert alleen de statische bestanden en draait de API-route niet.

### Structured output & validatie (providerneutraal)

Elke provider levert zijn antwoord via een gedwongen tool-/function-call in zijn eigen formaat (Anthropic `tool_use`, Gemini `functionCall`, Groq/OpenAI-stijl `tool_calls`), maar de adapter in `src/lib/ai-providers/` vertaalt dit altijd naar hetzelfde generieke `{ ok: true, input: {...} }`-resultaat. `kenniscentrum-chat.ts` valideert die `input` vervolgens **altijd zelf**, ongeacht welke provider hem leverde: elke `gebruikteBronIds`-verwijzing die niet in de daadwerkelijk opgehaalde bronnenlijst voorkomt wordt genegeerd, en zonder bronnen wordt `onvoldoendeInformatie` geforceerd op `true`. De modeloutput wordt dus nooit blind vertrouwd, welke provider er ook antwoordde.

### Misbruikbescherming en kostenbeheersing

- Maximale vraaglengte (600 tekens, zowel client- als server-side afgedwongen), maximale gespreksgeschiedenis (laatste 8 berichten) en een `max_tokens`-limiet op de AI-aanroep &mdash; ongewijzigd.
- Eenvoudige, in-memory rate limiting per IP-adres (12 aanvragen per 5 minuten, ongewijzigd) plus een globale limiet per serverless-instance, in `src/pages/api/kenniscentrum-chat.ts`. Deze globale limiet is bij deze wijziging **verlaagd van 40 naar 20 aanvragen/minuut**, om beter aan te sluiten bij de eigen (lagere) gratis-tier-limiet van Gemini (~15/minuut) en te voorkomen dat de applicatie zelf onnodig vaak tegen 429's van de gratis provider(s) aanloopt.
- Dit is bewust géén externe store (Vercel KV/Upstash e.d.) om geen nieuwe infrastructuur-afhankelijkheid toe te voegen; de teller leeft alleen zolang een serverless-instance warm is. Bij veel verkeer is een gedeelde store de logische vervolgstap.
- **Geen onverwachte kosten**: de standaardketen (`AI_PROVIDER=free` of geen waarde) bevat uitsluitend gratis providers. Anthropic wordt nooit automatisch als stille fallback gebruikt &mdash; dat vereist een expliciete, bewuste configuratiewijziging (`AI_PROVIDER=anthropic` of `free-with-paid-fallback`). Vallen zowel Gemini als Groq weg (storing, quota op), dan toont de assistent gewoon "De AI-assistent is momenteel niet beschikbaar" in plaats van ongemerkt over te schakelen naar een betaalde provider.
- **Misbruikrisico van de gratis tiers**: een individuele bezoeker kan, ondanks de rate limiting hierboven, in theorie de dagelijkse gratis quota van Gemini/Groq mede opmaken als er zeer veel verschillende bezoekers/IP-adressen tegelijk actief zijn. Bij een uitgeputte gratis quota geven beide providers een foutstatus terug (nooit een verrassende rekening), en valt de keten netjes terug op de volgende gratis provider of op de nette "niet beschikbaar"-melding.

### Privacy

- Gesprekken worden **niet permanent opgeslagen**: de geschiedenis leeft alleen in het geheugen van de browsertab (een gewone JavaScript-variabele) en is na een paginaverversing verdwenen. Er is geen database, geen cookie en geen localStorage voor chatinhoud. Dit gedrag is ongewijzigd.
- De pagina waarschuwt expliciet om geen BSN, wachtwoorden, bankgegevens of andere vertrouwelijke gegevens te delen.
- Externe artikeltekst die als context wordt meegegeven, wordt in de prompt expliciet als *data* behandeld (binnen een `<bronnen>`-blok), nooit als instructie &mdash; de systeemprompt instrueert het model om een "opdracht" die ergens in een artikel zou staan te negeren.
- **Wat een provider met de input doet (belangrijk verschil tussen de providers):**
  - **Google Gemini (gratis tier)**: Google geeft zelf aan dat bij *onbetaald* gebruik (dus ook de gratis tier van AI Studio/Gemini API) input en output gebruikt mogen worden om Google-producten en -modellen te verbeteren; menselijke reviewers kunnen dit lezen, al ontkoppelt Google de data eerst van accountgegevens. Dit is een bewuste afweging voor de gratis fase van dit project: er wordt geen persoonlijke bezoekersinformatie mee gestuurd (alleen de vraag zelf, het gesprek, en de openbare Kenniscentrum-/Belastingkalender-bronteksten), maar het is geen "zero data retention"-garantie zoals bij een betaalde tier. Bron: Google's Gemini API-voorwaarden.
  - **Groq**: treedt uitsluitend op als inferentie-provider voor open modellen (geen eigen modeltraining op klantverzoeken); raadpleeg Groq's actuele voorwaarden voor de exacte bewaartermijnen als dit relevant wordt.
  - **Anthropic** (indien expliciet ingeschakeld): ongewijzigd t.o.v. de oorspronkelijke integratie.
  - In alle gevallen ontvangt de provider alleen: de vraag van de bezoeker, het lopende gesprek (max. 8 berichten), en de opgehaalde, publieke Kenniscentrum-/Belastingkalender-/Avydo-contextsnippets &mdash; nooit IP-adressen, cookies, accountgegevens of andere identificerende bezoekersdata.

## Overig nog te koppelen

1. **Contactformulier & terugbelwidget** &mdash; werken nu via een `mailto:`-fallback (opent het mailprogramma van de bezoeker met het bericht klaar om te versturen naar `info@avydo.nl`). Voor directe verzending vanaf de website: koppel een formulierdienst (bijv. Formspree, Netlify Forms) of eigen backend in `src/components/ContactForm.astro` en `src/components/CallbackWidget.astro`.
2. **Fotografie** &mdash; de site gebruikt bewust geen stockfoto's. De teampagina heeft inmiddels echte foto's van René en Eric (`public/images/team/`); overige secties (hero, kantoor, Venray) kunnen op dezelfde manier worden aangevuld zodra er beeldmateriaal is.
3. **Analytics/cookies** &mdash; er is geen tracking geïmplementeerd. Voeg een cookieconsent-oplossing toe voordat analytics wordt geactiveerd (zie privacyverklaring).
4. **Video-ondertiteling** &mdash; de twee kennismakingsvideo's op `/diensten` (`public/videos/`) hebben nog geen ondertiteling/`<track>`-bestand. Voor WCAG 1.2.2 (captions) is een transcript van de gesproken tekst nodig om een `.vtt`-bestand te kunnen toevoegen aan `src/components/VideoCard.astro`.
