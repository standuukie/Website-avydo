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
| `ANTHROPIC_API_KEY` | Nee | GitHub &rarr; repository Secrets (Actions) | Betere AI-samenvatting. Zonder deze key werkt alles gewoon, met de extractieve samenvatting. |

Er zijn **geen** environment variables nodig op Vercel voor het Kenniscentrum zelf: de content wordt al als bestand meegeleverd bij het builden, Vercel hoeft niets op te halen. Sleutels staan nergens in de frontend of in git &mdash; alleen als GitHub Actions secret, alleen gebruikt binnen de workflow.

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

## Overig nog te koppelen

1. **Contactformulier & terugbelwidget** &mdash; werken nu via een `mailto:`-fallback (opent het mailprogramma van de bezoeker met het bericht klaar om te versturen naar `info@avydo.nl`). Voor directe verzending vanaf de website: koppel een formulierdienst (bijv. Formspree, Netlify Forms) of eigen backend in `src/components/ContactForm.astro` en `src/components/CallbackWidget.astro`.
2. **Fotografie** &mdash; de site gebruikt bewust geen stockfoto's. De teampagina heeft inmiddels echte foto's van René en Eric (`public/images/team/`); overige secties (hero, kantoor, Venray) kunnen op dezelfde manier worden aangevuld zodra er beeldmateriaal is.
3. **Analytics/cookies** &mdash; er is geen tracking geïmplementeerd. Voeg een cookieconsent-oplossing toe voordat analytics wordt geactiveerd (zie privacyverklaring).
4. **Video-ondertiteling** &mdash; de twee kennismakingsvideo's op `/diensten` (`public/videos/`) hebben nog geen ondertiteling/`<track>`-bestand. Voor WCAG 1.2.2 (captions) is een transcript van de gesproken tekst nodig om een `.vtt`-bestand te kunnen toevoegen aan `src/components/VideoCard.astro`.
