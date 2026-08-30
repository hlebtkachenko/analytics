import { embedMany } from 'ai';
import type { AiModelId, AiRegistry } from './registry.js';

type EmbedManyParameters = Parameters<typeof embedMany>[0];

// Every SDK call option except the model, which the registry resolves, and the values, which are required.
export type EmbedTextsOptions = Omit<
  EmbedManyParameters,
  'model' | 'values'
> & {
  values: readonly string[];
};

export type EmbeddedTexts = Awaited<ReturnType<typeof embedMany>>;

export function embedTexts(
  registry: AiRegistry,
  modelId: AiModelId,
  options: EmbedTextsOptions,
): Promise<EmbeddedTexts> {
  return embedMany({
    ...options,
    model: registry.embeddingModel(modelId),
    values: [...options.values],
  });
}
