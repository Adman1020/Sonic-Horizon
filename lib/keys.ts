import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encrypt';

// AI configuration is now container/operator-level, set once by an admin in
// the Admin panel and shared by every user. The old per-user providerKey table
// is gone — there is no "bring your own key" flow anymore.

export const AI_PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Google Gemini',
  'OpenRouter',
  'Microsoft Foundry',
  'Ollama',
] as const;

export type AIProvider = (typeof AI_PROVIDERS)[number];

export interface AIConfig {
  configured: boolean;
  provider: AIProvider | null;
  model: string | null;
  // Encrypted key, decrypted on read. Ollama stores its base URL here and has
  // no real secret, so apiKey may be null for it.
  apiKey: string | null;
  rpm: number;
}

export const APP_CONFIG_ID = 'global';

export async function getAIConfig(): Promise<AIConfig> {
  const cfg = await prisma.appConfig.findUnique({ where: { id: APP_CONFIG_ID } });
  if (!cfg?.aiProvider) {
    return { configured: false, provider: null, model: null, apiKey: null, rpm: 5 };
  }

  let apiKey: string | null = null;
  if (cfg.aiKeyData) {
    try {
      apiKey = decrypt(cfg.aiKeyData);
    } catch {
      apiKey = null;
    }
  }

  return {
    configured: true,
    provider: cfg.aiProvider as AIProvider,
    model: cfg.aiModel ?? null,
    apiKey,
    rpm: cfg.rpm ?? 5,
  };
}

// Admin-only save. A blank apiKey keeps the currently stored key (so the admin
// can tweak provider/model without retyping the secret); a value replaces it.
export async function saveAIConfig(opts: {
  provider: AIProvider;
  model?: string | null;
  apiKey?: string | null;
  rpm?: number;
}): Promise<void> {
  const existing = await prisma.appConfig.findUnique({ where: { id: APP_CONFIG_ID } });

  const keyProvided = typeof opts.apiKey === 'string' && opts.apiKey.trim().length > 0;
  const nextKeyData = keyProvided
    ? encrypt(opts.apiKey!.trim())
    : (existing?.aiKeyData ?? null);

  const now = new Date();
  await prisma.appConfig.upsert({
    where: { id: APP_CONFIG_ID },
    update: {
      aiProvider: opts.provider,
      aiModel: opts.model && opts.model.trim() ? opts.model.trim() : null,
      aiKeyData: nextKeyData,
      rpm: opts.rpm ?? existing?.rpm ?? 5,
      updatedAt: now,
    },
    create: {
      id: APP_CONFIG_ID,
      aiProvider: opts.provider,
      aiModel: opts.model && opts.model.trim() ? opts.model.trim() : null,
      aiKeyData: nextKeyData,
      rpm: opts.rpm ?? 5,
      createdAt: now,
      updatedAt: now,
    },
  });
}
