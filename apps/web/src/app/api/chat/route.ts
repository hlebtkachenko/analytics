import { createAiRegistry, loadAiConfiguration } from '@bap/ai';
import type { AiRegistry } from '@bap/ai';

import { chatRateLimit, handleChatRequest } from '../../../lib/ai/chat';
import { ChatRateLimiter } from '../../../lib/ai/rate-limit';
import { getAuth } from '../../../lib/auth/server';

// The provider credential is read from disk per process, so this route is never prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One window per web instance, exactly like the limiter the Nest guard holds.
const limiter = new ChatRateLimiter(chatRateLimit);

let registry: Promise<AiRegistry> | undefined;

async function loadRegistry(): Promise<AiRegistry> {
  registry ??= loadAiConfiguration(process.env).then((configuration) =>
    createAiRegistry(configuration),
  );

  try {
    return await registry;
  } catch (error) {
    // A rejected promise would otherwise cache the credential failure for the whole process.
    registry = undefined;
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getAuth();
  return handleChatRequest({ auth: auth.api, limiter, loadRegistry }, request);
}
