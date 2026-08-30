import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai';
import type { AiConfiguration, AiProviderName } from './config.js';

// Models are addressed by their fully qualified `provider:model` identifier.
export type AiModelId = `${AiProviderName}:${string}`;

export type AiLanguageModel = ReturnType<
  ProviderRegistryProvider['languageModel']
>;

type AiProvider = Parameters<typeof createProviderRegistry>[0][string];

interface ProviderSettings {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

type ProviderFactory = (settings: ProviderSettings) => AiProvider;

// Adding a provider here keeps the credential shape and the container topology unchanged.
const providerFactories: Record<AiProviderName, ProviderFactory> = {
  anthropic: createAnthropic,
  openai: createOpenAI,
};

export interface AiRegistryOptions {
  // Injected transport for tests and proxies; production leaves the provider default in place.
  fetch?: typeof globalThis.fetch;
}

export interface AiRegistry {
  languageModel(id: AiModelId): AiLanguageModel;
  // Resolves a role named by the credential to a fully qualified model identifier.
  modelId(role: string): AiModelId;
  readonly provider: AiProviderName;
}

export function createAiRegistry(
  configuration: AiConfiguration,
  options: AiRegistryOptions = {},
): AiRegistry {
  const provider = providerFactories[configuration.provider]({
    apiKey: configuration.apiKey,
    ...(configuration.baseUrl === undefined
      ? {}
      : { baseURL: configuration.baseUrl }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const registry = createProviderRegistry({
    [configuration.provider]: provider,
  });

  return {
    languageModel(id: AiModelId): AiLanguageModel {
      return registry.languageModel(id);
    },

    modelId(role: string): AiModelId {
      const model = configuration.models[role];

      if (model === undefined) {
        throw new Error(`The AI credential names no model for role ${role}.`);
      }

      return `${configuration.provider}:${model}`;
    },

    provider: configuration.provider,
  };
}
