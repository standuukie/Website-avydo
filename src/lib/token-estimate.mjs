// Grove, lokale schatting van het aantal LLM-tokens in een stuk tekst.
// Bewust géén echte tokenizer (tiktoken e.d.): dat zou een nieuwe
// dependency toevoegen voor een doel waarvoor een eenvoudige, robuuste
// schatting ruim voldoende is — dit wordt uitsluitend gebruikt om vóóraf,
// lokaal, te beslissen of een verzoek waarschijnlijk over Groq's eigen
// tokens-per-minuut-limiet (TPM) heen zou gaan (zie rate-limit.mjs en
// kenniscentrum-chat.ts), niet om exact te factureren of te matchen met
// wat Groq zelf telt.
//
// ~4 tekens per token is de gebruikelijke, veelgebruikte vuistregel voor
// Engels/Nederlands GPT-achtige tokenizers (ruwweg 0,75 woorden/token) —
// een lichte OVERschatting is hier bewust veiliger dan een onderschatting,
// omdat dit getal gebruikt wordt om te BESCHERMEN tegen het overschrijden
// van een echte, externe limiet.
const CHARS_PER_TOKEN = 4;

/** @param {string | null | undefined} text */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Som van de geschatte tokens van meerdere tekststukken. @param {Array<string | null | undefined>} texts */
export function estimateTotalTokens(texts) {
  return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}
