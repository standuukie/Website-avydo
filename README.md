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
- `src/content/kenniscentrum/` &mdash; automatisch (en eventueel handmatig) beheerde Kenniscentrum-artikelen; zie hieronder.
- `scripts/kenniscentrum/` &mdash; het ophaalscript en de bronconfiguratie voor het Kenniscentrum.
- `.github/workflows/kenniscentrum-update.yml` &mdash; de dagelijkse GitHub Actions-job die nieuwe artikelen ophaalt.

## Kenniscentrum: automatische actualisatie

`/kenniscentrum` toont automatisch verzamelde ontwikkelingen (belastingen, personeel & loon, ondernemen, wet- en regelgeving, subsidies, financiën, accountancy) die relevant zijn voor Nederlandse mkb-ondernemers. Artikelen worden **nooit volledig gekopieerd**: het systeem haalt alleen titel, datum, bron en een korte samenvatting op, schrijft er een eigen "wat betekent dit voor jou"-tekst bij, en verwijst voor de volledige tekst altijd naar de oorspronkelijke bron.

### Architectuur

```
RSS-feeds + Google News-sitemaps (officiële bronnen)
   -> scripts/kenniscentrum/fetch-articles.mjs   (GitHub Actions, dagelijks)
   -> filtering op relevantie + categorie/prioriteit
   -> samenvatting (extractief, of optioneel via Claude Haiku)
   -> src/content/kenniscentrum/*.md              (Astro content collection)
   -> git commit + push
   -> Vercel bouwt en deployt automatisch (bestaande GitHub-koppeling)
```

De site zelf blijft volledig statisch: er draait geen server of API-route in productie. Het "backend"-gedeelte is een GitHub Actions workflow (`.github/workflows/kenniscentrum-update.yml`) die dagelijks (en handmatig via "Run workflow" in de Actions-tab) nieuwe artikelen ophaalt en als gewone bestanden in de repository commit. Dat is bewust gekozen boven Vercel Cron: volledig gratis, geen Vercel-planbeperkingen, en de content staat gewoon in git (dus ook zichtbaar/reviewbaar/terug te draaien via de normale GitHub-historie).

### Gebruikte bronnen

Zie `scripts/kenniscentrum/sources.config.mjs` voor de volledige, becommentarieerde lijst. Op dit moment:

| Bron | Type | Bron-URL | Categorie |
|---|---|---|---|
| Belastingdienst (Actueel zakelijk) | RSS | `nieuwsfeed_actueel_zakelijk.xml` | Belastingen |
| Rijksoverheid | Google News-sitemap | `rijksoverheid.nl/news/sitemap.xml` | gemengd (streng gefilterd op brede mkb-trefwoorden; publicaties van het Ministerie van Financiën tellen altijd mee) |
| MKB-Nederland | RSS (eigen nieuwsfeed) | `mkb.nl/rss/nieuws-mkb-nederland` | Ondernemen |

Elke bron heeft een `urlConfidence`-veld: `confirmed` betekent dat de exacte URL rechtstreeks live is getest (niet via een zoekmachine); `inferred` betekent dat de URL een bevestigd patroon volgt maar niet 1-op-1 live is geverifieerd. Het ophaalscript controleert dit bij elke run zelf: een niet-bereikbare of ongeldige feed/sitemap wordt overgeslagen (nooit verzonnen), en de uitkomst per bron — inclusief de stadia *opgehaald → geparsed → relevant → gepubliceerd* — is zichtbaar in de samenvatting van elke workflow-run (tab **Actions** &rarr; run &rarr; "Summary") en in de jobs-log.

**Bron-types** (veld `type` in `sources.config.mjs`):
- `rss`: een RSS/Atom-feed met title/link/description/pubDate per item.
- `sitemap`: een Google News-sitemap (`xmlns:news`), die alleen recente artikelen bevat (titel, publicatiedatum, canonieke URL) zonder samenvattingstekst. Voor elk nieuw artikel wordt de paginabron zelf opgehaald om de `meta description`/`og:description` te lezen als brontekst voor de samenvatting, en (bij de Rijksoverheid-bron) de breadcrumb-link naar `/ministeries/<slug>` om ministerie-specifieke publicaties (Financiën) altijd als relevant te markeren, ook zonder trefwoordtreffer (`ministryBypass`-veld).

**Waarom Rijksoverheid een sitemap gebruikt in plaats van RSS**: rijksoverheid.nl is medio 2026 overgestapt op een nieuw technisch platform, waarbij de oude RSS-infrastructuur op `feeds.rijksoverheid.nl` buiten gebruik is geraakt (het domein resolvet niet meer — dit was structureel de oorzaak dat er nooit Rijksoverheid-artikelen verschenen, ook al werkte de Belastingdienst-feed in dezelfde runs prima). `rijksoverheid.nl/news/sitemap.xml` is live geverifieerd als werkende, officiële vervanging.

Om te voorkomen dat één bron structureel (bijna) alle artikelen levert, geldt naast het totale `maxArticlesPerRun` ook een `maxArticlesPerSourcePerRun`-plafond per bron per run.

**Onderzocht maar niet geïntegreerd** (elk daadwerkelijk live getest, niet via een zoekmachine of giswerk — zie de uitgebreide toelichting in `sources.config.mjs`):
- **KVK** (`kvk.nl/overzicht/`): geen RSS of sitemap die het nieuwsoverzicht dekt; de pagina haalt content client-side op bij een intern, niet-publiek Bloomreach-CMS-endpoint. Geen officiële methode beschikbaar zonder hun interne SPA-backend te reverse-engineeren.
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

- **Verwijderen**: het bestand verwijderen (en committen/pushen).
- **Verbergen** (blijft bestaan maar niet zichtbaar): `hidden: true` zetten in de frontmatter.
- **Uitlichten** (bovenaan als "Uitgelicht"): `featured: true` zetten.
- **Categorie/prioriteit aanpassen**: `category` of `priority` direct in de frontmatter wijzigen.

### AI-samenvatting (optioneel)

Standaard gebruikt het script **geen AI**: de samenvatting is de (opgeschoonde, van HTML ontdane) eigen tekst uit de RSS-feed van de bron zelf, aangevuld met een vast, per categorie afgestemd sjabloon voor "wat betekent dit voor jou". Dit kost niets en kan nooit feiten verzinnen.

Optioneel kan een betere, meer toegespitste samenvatting worden gegenereerd door Claude Haiku. Dit wordt automatisch geactiveerd zodra het GitHub Actions secret `ANTHROPIC_API_KEY` is ingesteld (Settings &rarr; Secrets and variables &rarr; Actions &rarr; New repository secret). De AI-prompt (zie `aiSummary()` in `fetch-articles.mjs`) staat expliciet niet toe om feiten, cijfers, bedragen of regels te verzinnen die niet letterlijk in de brontekst staan; bij twijfel of een fout valt het script automatisch terug op de gratis extractieve samenvatting. Omdat alleen *nieuwe* artikelen worden verwerkt (bestaande worden nooit opnieuw langs de AI gestuurd), blijft het aantal API-calls vanzelf beperkt.

### Environment variables

| Variabele | Verplicht | Waar instellen | Doel |
|---|---|---|---|
| `GEMINI_API_KEY` | Nee (aanbevolen) | Vercel &rarr; Project Settings &rarr; Environment Variables | Primaire, gratis AI-provider voor de AI-assistent (`/kenniscentrum/ai-assistent`). Zie "Kenniscentrum: AI-assistent" hieronder. |
| `GROQ_API_KEY` | Nee (aanbevolen) | Vercel &rarr; Project Settings &rarr; Environment Variables | Secundaire, gratis fallback-provider voor de AI-assistent. |
| `AI_PROVIDER` | Nee | Vercel &rarr; Project Settings &rarr; Environment Variables | Kiest de providerketen (`free` = standaard). Zie "Provider-configuratie" hieronder. |
| `ANTHROPIC_API_KEY` | Nee | GitHub &rarr; repository Secrets (Actions) **én/of** Vercel &rarr; Project Settings &rarr; Environment Variables | Betere AI-samenvatting in de nieuwsengine, en (alleen bij expliciete `AI_PROVIDER=anthropic`/`free-with-paid-fallback`) een optionele, betaalde provider voor de AI-assistent. |

Alle sleutels worden uitsluitend server-side gebruikt:
- `ANTHROPIC_API_KEY` in GitHub Actions (workflow "Kenniscentrum bijwerken") voor een optioneel betere samenvatting bij het ophalen van nieuwe artikelen. Zonder deze key werkt alles gewoon, met de extractieve samenvatting.
- `GEMINI_API_KEY`/`GROQ_API_KEY`/`ANTHROPIC_API_KEY` op Vercel, gelezen door `src/pages/api/kenniscentrum-chat.ts` en `src/lib/ai-providers/` (een serverless function, zie hieronder) voor de AI-assistent. **Zonder minstens één geldige sleutel op Vercel toont de assistent een nette "momenteel niet beschikbaar"-melding** in plaats van te crashen; de rest van de website blijft gewoon werken.

Sleutels staan nergens in de frontend of in git &mdash; alleen als secret/environment variable, alleen server-side gelezen. Dit is na implementatie expliciet gecontroleerd door de volledige Vercel build-output te doorzoeken op de sleutelnamen en provider-domeinen: die komen alleen voor in de servergebundelde function, nooit in de statische client-bundels.

### Fallback en betrouwbaarheid

- Iedere bron wordt los geprobeerd (try/catch); een niet-bereikbare of ongeldige feed/sitemap stopt de andere bronnen niet.
- Er wordt nooit content verzonnen: zonder voldoende broninformatie (te korte beschrijving, ontbrekende titel/link) wordt een item overgeslagen.
- De workflow faalt nooit hard op een bronprobleem (exit code altijd 0) &mdash; anders zou een tijdelijk offline feed onterecht een rode kruis in GitHub Actions veroorzaken.
- Omdat artikelen gewone, gecommitte bestanden zijn, is de site nooit leeg of stuk door een tijdelijk niet-beschikbare bron: het laatst succesvol opgehaalde resultaat blijft gewoon live staan totdat de volgende run iets nieuws vindt.
- Is de collectie nog helemaal leeg (bijvoorbeeld vóór de eerste run), dan toont `/kenniscentrum` een nette "binnenkort"-melding in plaats van een lege of kapotte pagina.

### Kosten

- GitHub Actions: gratis binnen de standaard minutenlimiet van deze repository (de job duurt typisch enkele seconden tot een minuut per run).
- Bronnen: gratis, publieke overheidsfeeds en -sitemaps.
- AI-samenvatting: optioneel, alleen bij gezette `ANTHROPIC_API_KEY`, alleen voor nieuwe artikelen (geen herhaalde verwerking van bestaande content).
- Geen betaalde nieuws-API's of zoekdiensten gebruikt.

### Handmatig een run starten

GitHub &rarr; tab **Actions** &rarr; workflow "Kenniscentrum bijwerken" &rarr; **Run workflow**. Of lokaal: `npm run kenniscentrum:fetch` (schrijft direct naar `src/content/kenniscentrum/`).

## Kenniscentrum: AI-assistent

`/kenniscentrum/ai-assistent` is een chatinterface waarmee bezoekers vragen kunnen stellen over belastingen, accountancy en ondernemen. Vanaf een artikelpagina kan via "Vraag het aan onze AI-assistent" ook een vraag over dát specifieke artikel gesteld worden (`?artikel=<slug>`).

### Architectuur (RAG, geen los model)

De assistent verzint nooit zelf fiscale feiten. Elke vraag doorloopt:

1. **Retrieval** (`src/lib/ai-assistent.ts`, `retrieveContext()`): een lichte, trefwoord-gebaseerde zoekfunctie over de **bestaande** databronnen &mdash; de Kenniscentrum-contentcollectie (`getCollection('kenniscentrum')`), de Belastingkalender-dataset (`src/data/belastingkalender.ts`) en een klein stukje Avydo-contactinformatie. Er is bewust **geen** aparte nieuws- of vectordatabase toegevoegd.
2. De gevonden bronnen (elk met een echte, al bestaande URL) worden als genummerde lijst meegegeven aan het taalmodel.
3. Het model antwoordt via een **gedwongen tool-call** (structured output, geen vrije tekst) met velden als `kortAntwoord`, `toelichting`, `letOp`, `gebruikteBronIds`, `onvoldoendeInformatie` en `verwijstNaarPersoonlijkAdvies`.
4. **Server-side validatie**: elke `gebruikteBronIds`-verwijzing die niet in de daadwerkelijk opgehaalde bronnenlijst voorkomt, wordt genegeerd. Zo kan een verzonnen bron of URL nooit bij de bezoeker terechtkomen. Zijn er helemaal geen bronnen gevonden, dan wordt `onvoldoendeInformatie` altijd geforceerd op `true`, ongeacht wat het model zelf teruggeeft.

De volledige systeemprompt (stijl, brongebruik, privacy/veiligheidsregels) staat in `src/pages/api/kenniscentrum-chat.ts`.

### Gebruikte AI-provider(s): gratis-eerst, providerneutraal

De AI-assistent gebruikt **standaard uitsluitend gratis AI-providers**, zonder creditcard, via een kleine provider-abstractielaag in `src/lib/ai-providers/`:

| Provider | Rol | Model (standaard) | Env-var(s) |
|---|---|---|---|
| **Google Gemini** | Primair | `gemini-flash-latest` (officiële Google-alias, wijst automatisch naar het actuele Flash-model) | `GEMINI_API_KEY`, optioneel `GEMINI_MODEL` |
| **Groq** | Fallback, als Gemini faalt/geen quota meer heeft | `llama-3.3-70b-versatile` | `GROQ_API_KEY`, optioneel `GROQ_MODEL` |
| **Anthropic Claude** | Optioneel, **standaard uitgeschakeld** | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY`, optioneel `ANTHROPIC_MODEL` |

**Waarom Gemini als primaire keuze** (vergeleken met Groq, OpenRouter en Vercel AI Gateway, onderzocht september 2026):
- Een daadwerkelijk gratis API-sleutel via Google AI Studio, **zonder creditcard**, met een ruime gratis-quota (orde van grootte 15 requests/minuut, 1.500 requests/dag, 1M tokens/minuut — deze cijfers zijn door Google zelf gepubliceerd en kunnen per model licht verschillen; controleer de actuele waarden op [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits) omdat dit type limiet vaker wijzigt dan de rest van deze documentatie).
- Sterke Nederlandstalige kwaliteit, geschikt voor het uitleggen van fiscale/accountancy-onderwerpen.
- Ondersteunt **gedwongen function calling** (`toolConfig.functionCallingConfig.mode: "ANY"`), functioneel gelijk aan Anthropic's `tool_choice`: het model *moet* de opgegeven tool aanroepen, en de server valideert de output alsnog altijd zelf (zie hieronder).
- **Geverifieerd**: tijdens ontwikkeling is een echte (ongeldige) aanroep naar `generativelanguage.googleapis.com` gedaan; Google's API accepteerde het verzoekformaat en gaf een specifieke, correcte authenticatiefout terug (`API_KEY_INVALID`) &mdash; dit bevestigt dat de requestopbouw (URL, headers, JSON-vorm) klopt tegen de echte, actuele API.

**Waarom Groq als fallback** (en niet als primaire keuze): eveneens daadwerkelijk gratis zonder creditcard, met eigen or model afhankelijke limieten (orde van grootte 30 requests/minuut; zie [console.groq.com](https://console.groq.com/docs/rate-limits) voor de actuele cijfers per model). Twee onafhankelijke gratis providers na elkaar betekent dat een storing of uitgeputte quota bij Gemini niet meteen de hele assistent platlegt. Ondersteunt eveneens een gedwongen `tool_choice`.

**Waarom niet OpenRouter**: de gratis modellen daar zijn beperkt tot 20 requests/minuut én slechts 50 requests/dag (zonder ooit een creditcard toegevoegd te hebben), en de beschikbare gratis modellen wisselen periodiek &mdash; te instabiel en te krap voor een publieke pagina.
**Waarom niet Vercel AI Gateway**: geeft $5 gratis krediet per maand, maar is daarmee een *krediet met een bodem* in plaats van een onvoorwaardelijk gratis tier; bij uitputting zou dit (afhankelijk van de Vercel-projectinstellingen) kunnen doorlopen in betaald verbruik, wat afwijkt van de "nooit ongemerkt kosten"-eis van dit project.

Beide gratis providers worden aangeroepen met een rechtstreekse `fetch` (geen extra SDK-dependency), op dezelfde manier als de bestaande Anthropic-integratie dat al deed.

### Provider-configuratie (`AI_PROVIDER`)

```
AI_PROVIDER=free                     # standaard (ook als de variabele ontbreekt): Gemini → Groq, nooit betaald
AI_PROVIDER=free-with-paid-fallback  # Gemini → Groq → Anthropic als allerlaatste, betaald redmiddel
AI_PROVIDER=gemini                   # alleen Gemini (bv. om gericht te testen)
AI_PROVIDER=groq                     # alleen Groq
AI_PROVIDER=anthropic                # alleen Anthropic (het oorspronkelijke gedrag vóór deze wijziging)
```

Een onbekende of lege waarde valt altijd terug op de veilige standaard (`free`). De keten wordt bepaald in `src/lib/ai-providers/index.ts` (`resolveProviderChain()`); elke provider daarin is een losstaande adapter die dezelfde `AiProvider`-interface implementeert (`src/lib/ai-providers/types.ts`), zodat een nieuwe provider toevoegen of de standaardkeuze wijzigen geen wijzigingen elders vereist (retrieval, promptopbouw, brontoewijzing-validatie en de frontend blijven ongewijzigd, ongeacht welke provider actief is).

**Bestaande Anthropic-integratie is behouden, niet verwijderd** &mdash; alleen verplaatst naar `src/lib/ai-providers/anthropic.ts` en niet meer standaard actief. Wie later (weer) naar Anthropic wil overschakelen, zet `AI_PROVIDER=anthropic` (of `free-with-paid-fallback` voor een gratis-eerst-met-betaald-vangnet-opstelling) en de bestaande `ANTHROPIC_API_KEY`.

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
