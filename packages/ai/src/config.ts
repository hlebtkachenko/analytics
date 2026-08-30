import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

// scripts/create-local-secrets.sh seeds this exact value, which is never a usable key.
export const developmentPlaceholderApiKey = 'local-development-placeholder';

export const aiProviderNames = ['anthropic', 'openai'] as const;

export type AiProviderName = (typeof aiProviderNames)[number];

const environmentSchema = z.object({
  BAP_AI_PROVIDER_CONFIG_FILE: z.string().min(1),
});

const baseUrlSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) {
    return false;
  }
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
});

const credentialSchema = z
  .object({
    apiKey: z.string().min(1).max(512),
    baseUrl: baseUrlSchema.optional(),
    models: z
      .record(z.string().min(1).max(64), z.string().min(1).max(128))
      .default({}),
    provider: z.enum(aiProviderNames),
  })
  .strict();

export interface AiConfiguration {
  apiKey: string;
  // undefined when the credential names no proxy or regional endpoint.
  baseUrl: string | undefined;
  // Model names are provider-specific, so the credential names one per role.
  models: Readonly<Record<string, string>>;
  provider: AiProviderName;
}

type Environment = Record<string, string | undefined>;

async function readProviderCredentialFile(path: string): Promise<string> {
  const details = await stat(path);

  const permissions = details.mode & 0o777;

  if (!details.isFile() || ![0o400, 0o444, 0o600].includes(permissions)) {
    throw new Error(
      'AI provider credential file must be a protected regular file.',
    );
  }

  const content = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');

  if (content.length === 0) {
    throw new Error('AI provider credential file is empty.');
  }

  return content;
}

export async function loadAiConfiguration(
  environment: Environment,
): Promise<AiConfiguration> {
  const parsed = environmentSchema.parse(environment);
  const document = await readProviderCredentialFile(
    parsed.BAP_AI_PROVIDER_CONFIG_FILE,
  );

  let candidate: unknown;

  try {
    candidate = JSON.parse(document);
  } catch {
    // A parser error can quote credential content, so it never leaves this function.
    throw new Error('AI provider credential file is not valid JSON.');
  }

  const credential = credentialSchema.safeParse(candidate);

  if (!credential.success) {
    // Validation issues can carry the rejected value, so only field paths are reported.
    const fields = credential.error.issues
      .map((issue) => issue.path.join('.') || issue.code)
      .join(', ');

    throw new Error(`AI provider credential file is invalid: ${fields}.`);
  }

  // The seeded local placeholder is never usable, so it must not reach a provider.
  if (credential.data.apiKey === developmentPlaceholderApiKey) {
    throw new Error(
      'The AI provider requires a real API key. Replace the local development placeholder in the credential file.',
    );
  }

  return {
    apiKey: credential.data.apiKey,
    baseUrl: credential.data.baseUrl,
    models: credential.data.models,
    provider: credential.data.provider,
  };
}
