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

const providerCredentialSchema = z
  .object({
    apiKey: z.string().min(1).max(512),
    baseUrl: baseUrlSchema.optional(),
  })
  .strict();

// No provider serves every role, so a role names the provider that serves it as well as the model.
const modelSelectionSchema = z
  .object({
    model: z.string().min(1).max(128),
    provider: z.enum(aiProviderNames),
  })
  .strict();

const credentialSchema = z
  .object({
    models: z
      .record(z.string().min(1).max(64), modelSelectionSchema)
      .default({}),
    // At least one provider, so a credential that configures none fails here instead of at a call.
    providers: z
      .partialRecord(z.enum(aiProviderNames), providerCredentialSchema)
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();

export interface AiProviderCredential {
  apiKey: string;
  // undefined when the credential names no proxy or regional endpoint.
  baseUrl: string | undefined;
}

export interface AiModelSelection {
  model: string;
  provider: AiProviderName;
}

export interface AiConfiguration {
  // Model names are provider-specific, so the credential names one provider and model per role.
  models: Readonly<Record<string, AiModelSelection>>;
  // Only the providers the credential configures; a model role may name no other.
  providers: Readonly<Partial<Record<AiProviderName, AiProviderCredential>>>;
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

  const providers: Partial<Record<AiProviderName, AiProviderCredential>> = {};

  for (const name of aiProviderNames) {
    const configured = credential.data.providers[name];

    if (configured === undefined) {
      continue;
    }

    // The seeded local placeholder is never usable, so it must not reach a provider.
    if (configured.apiKey === developmentPlaceholderApiKey) {
      throw new Error(
        'The AI provider requires a real API key. Replace the local development placeholder in the credential file.',
      );
    }

    providers[name] = {
      apiKey: configured.apiKey,
      baseUrl: configured.baseUrl,
    };
  }

  const models: Record<string, AiModelSelection> = {};

  for (const [role, selection] of Object.entries(credential.data.models)) {
    // A role pointing at a provider the credential omits must fail now, not at the first model call.
    if (providers[selection.provider] === undefined) {
      throw new Error(
        `AI provider credential file names model role ${role} on provider ${selection.provider}, which it does not configure.`,
      );
    }

    models[role] = { model: selection.model, provider: selection.provider };
  }

  return { models, providers };
}
