// ── LLM Engine Service — All providers ────────────────────────────────────────
// Verified API formats — 2025

export type ProviderType =
  | 'OpenAI'
  | 'Anthropic'
  | 'Google Gemini'
  | 'OpenRouter'
  | 'Microsoft Foundry'
  | 'Ollama';

export interface LLMRequest {
  provider: ProviderType;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  delayMs?: number;
}

export interface Recommendation {
  artist: string;
  title: string;
  reasoning: string;
  genre_tags: string[];
}

export interface LLMResult {
  recommendations: Recommendation[];
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function parseJsonResponse(raw: string): LLMResult {
  // Strip markdown fences some models add
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed?.recommendations)) {
    throw new Error('Invalid LLM response structure: missing recommendations array');
  }
  return parsed as LLMResult;
}

export async function generateDiscoveryPlaylist(req: LLMRequest): Promise<LLMResult> {
  if (req.delayMs && req.delayMs > 0) await sleep(req.delayMs);

  switch (req.provider) {
    case 'OpenAI':            return callOpenAI(req);
    case 'Anthropic':         return callAnthropic(req);
    case 'Google Gemini':     return callGemini(req);
    case 'OpenRouter':        return callOpenRouter(req);
    case 'Microsoft Foundry': return callFoundry(req);
    case 'Ollama':            return callOllama(req);
    default:
      throw new Error(`Unknown provider: ${req.provider}`);
  }
}

// ── OpenAI ─────────────────────────────────────────────────────────────────────
async function callOpenAI(req: LLMRequest): Promise<LLMResult> {
  const model = req.model || 'gpt-4.1-nano';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI ${res.status}: ${(err as { error?: { message?: string } }).error?.message ?? res.statusText}`);
  }
  const data = await res.json();
  return parseJsonResponse(data.choices[0].message.content);
}

// ── Anthropic ──────────────────────────────────────────────────────────────────
async function callAnthropic(req: LLMRequest): Promise<LLMResult> {
  const model = req.model || 'claude-haiku-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic ${res.status}: ${(err as { error?: { message?: string } }).error?.message ?? res.statusText}`);
  }
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '';
  return parseJsonResponse(text);
}

// ── Google Gemini ──────────────────────────────────────────────────────────────
// Uses system_instruction field (required for Gemini 1.5+)
// Endpoint: generativelanguage.googleapis.com/v1beta
async function callGemini(req: LLMRequest): Promise<LLMResult> {
  const model = req.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${req.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: req.systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: req.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
    const msg = err?.error?.message ?? res.statusText;
    throw new Error(`Gemini ${res.status} (${err?.error?.status ?? 'ERROR'}): ${msg}`);
  }

  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned empty response (finishReason: ${reason ?? 'unknown'})`);
  }
  return parseJsonResponse(text);
}

// ── OpenRouter ─────────────────────────────────────────────────────────────────
async function callOpenRouter(req: LLMRequest): Promise<LLMResult> {
  const model = req.model || 'openrouter/free';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
      'HTTP-Referer': 'http://localhost:8080',
      'X-Title': 'Sonic Horizon',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter ${res.status}: ${(err as { error?: { message?: string } }).error?.message ?? res.statusText}`);
  }
  const data = await res.json();
  return parseJsonResponse(data.choices[0].message.content);
}

// ── Microsoft Azure AI Foundry ─────────────────────────────────────────────────
// apiKey format: "https://your-resource.openai.azure.com::your-api-key"
async function callFoundry(req: LLMRequest): Promise<LLMResult> {
  const model = req.model || 'gpt-4o-mini';
  const [endpoint, key] = req.apiKey.includes('::')
    ? req.apiKey.split('::')
    : ['https://api.foundry.azure.com', req.apiKey];

  const url = `${endpoint}/openai/deployments/${model}/chat/completions?api-version=2024-08-01-preview`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': key,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    throw new Error(`Azure Foundry ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  return parseJsonResponse(data.choices[0].message.content);
}

// ── Ollama (local) ─────────────────────────────────────────────────────────────
// apiKey field holds the base URL
async function callOllama(req: LLMRequest): Promise<LLMResult> {
  const baseUrl = req.apiKey?.startsWith('http')
    ? req.apiKey.replace(/\/$/, '')
    : 'http://host.docker.internal:11434';
  const model = req.model || 'llama3.2';

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return parseJsonResponse(data.message?.content ?? '');
}
