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

## Nog te koppelen

1. **Contactformulier & terugbelwidget** &mdash; werken nu via een `mailto:`-fallback (opent het mailprogramma van de bezoeker met het bericht klaar om te versturen naar `info@avydo.nl`). Voor directe verzending vanaf de website: koppel een formulierdienst (bijv. Formspree, Netlify Forms) of eigen backend in `src/components/ContactForm.astro` en `src/components/CallbackWidget.astro`.
2. **Fotografie** &mdash; de site gebruikt bewust geen stockfoto's. Zodra er echte foto's zijn (kantoor, team, Venray), kunnen die worden toegevoegd aan `public/images/` en verwerkt in de hero, teampagina en dienstenpagina's.
3. **Kenniscentrum** &mdash; de pagina staat klaar voor content maar bevat nog geen artikelen (om geen verouderd nieuws uit 2009-2010 als actueel te presenteren). Voeg een content collection toe zodra er actuele artikelen zijn.
4. **Analytics/cookies** &mdash; er is geen tracking geïmplementeerd. Voeg een cookieconsent-oplossing toe voordat analytics wordt geactiveerd (zie privacyverklaring).
