import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createProviderRegistry, type ProviderRegistryProvider } from 'ai';
import { aiProviderNames } from './config.js';
import type { AiConfiguration, AiProviderName } from './config.js';

// Models are addressed by their fully qualified `provider:model` identifier.
export type AiModelId = `${AiProviderName}:${string}`;

export type AiLanguageModel = ReturnType<
  ProviderRegistryProvider['languageModel']
>;

export type AiEmbeddingModel = ReturnType<
  ProviderRegistryProvider['embeddingModel']
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
  embeddingModel(id: AiModelId): AiEmbeddingModel;
  languageModel(id: AiModelId): AiLanguageModel;
  // Resolves a role named by the credential to a fully qualified model identifier.
  modelId(role: string): AiModelId;
}

// The registry separator is a colon, so the prefix of a model id is the provider that serves it.
export function providerOfModelId(id: AiModelId): AiProviderName {
  return id.slice(0, id.indexOf(':')) as AiProviderName;
}

export function createAiRegistry(
  configuration: AiConfiguration,
  options: AiRegistryOptions = {},
): AiRegistry {
  const providers: Record<string, AiProvider> = {};

  for (const name of aiProviderNames) {
    const credential = configuration.providers[name];

    if (credential === undefined) {
      continue;
    }

    providers[name] = providerFactories[name]({
      apiKey: credential.apiKey,
      ...(credential.baseUrl === undefined
        ? {}
        : { baseURL: credential.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  const registry = createProviderRegistry(providers);

  return {
    embeddingModel(id: AiModelId): AiEmbeddingModel {
      return registry.embeddingModel(id);
    },

    languageModel(id: AiModelId): AiLanguageModel {
      return registry.languageModel(id);
    },

    modelId(role: string): AiModelId {
      const selection = configuration.models[role];

      if (selection === undefined) {
        throw new Error(`The AI credential names no model for role ${role}.`);
      }

      return `${selection.provider}:${selection.model}`;
    },
  };
}
