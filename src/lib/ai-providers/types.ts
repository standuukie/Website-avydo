// Provider-onafhankelijke types voor de AI-assistent. Elke provider
// (Gemini, Groq, Anthropic, ...) implementeert AiProvider en vertaalt de
// generieke ToolDefinition/ChatMessage-vorm naar zijn eigen API-formaat.
// Dit houdt de rest van de applicatie (retrieval, promptopbouw,
// brontoewijzing-validatie in de API-route) volledig onafhankelijk van
// welke provider daadwerkelijk wordt gebruikt.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Providerneutrale tool-definitie: een JSON Schema-achtig object, zonder providerspecifieke wrapper-velden. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ProviderCallArgs {
  systemPrompt: string;
  messages: ChatMessage[];
  tool: ToolDefinition;
  maxOutputTokens: number;
  timeoutMs: number;
}

export type ProviderCallResult =
  | { ok: true; input: Record<string, unknown>; providerId: string }
  | { ok: false; error: string; providerId: string };

export interface AiProvider {
  id: string;
  /** Mensleesbare naam, alleen voor logs/README — nooit aan de bezoeker getoond. */
  label: string;
  /** True als de benodigde server-side environment variable(s) aanwezig zijn. */
  isConfigured(): boolean;
  call(args: ProviderCallArgs): Promise<ProviderCallResult>;
}
