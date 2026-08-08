import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAIConfig, saveAIConfig, AI_PROVIDERS } from '@/lib/keys';

// Admin-managed AI configuration. The API key is encrypted at rest and never
// returned to the client — GET reports whether one is stored, nothing more.

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  try {
    const ai = await getAIConfig();
    return NextResponse.json({
      ai: {
        configured: ai.configured,
        provider: ai.provider,
        model: ai.model,
        hasKey: ai.provider !== 'Ollama' ? !!ai.apiKey : true,
        rpm: ai.rpm,
      },
    });
  } catch (error) {
    console.error('Admin config GET error:', error);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  try {
    const body = await req.json();
    const provider = body?.provider;
    if (typeof provider !== 'string' || !(AI_PROVIDERS as readonly string[]).includes(provider)) {
      return NextResponse.json({ error: 'Valid provider required' }, { status: 400 });
    }

    const rpm = body?.rpm === undefined ? undefined : Number(body.rpm);
    if (rpm !== undefined && (!Number.isInteger(rpm) || rpm < 0 || rpm > 600)) {
      return NextResponse.json({ error: 'Rate limit must be between 0 and 600 req/min' }, { status: 400 });
    }

    await saveAIConfig({
      provider: provider as (typeof AI_PROVIDERS)[number],
      model: typeof body?.model === 'string' ? body.model : null,
      apiKey: typeof body?.apiKey === 'string' ? body.apiKey : null,
      rpm: rpm ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin config PUT error:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
