import { embedMany } from 'ai';
import { providerOfModelId } from './registry.js';
import type { AiModelId, AiRegistry } from './registry.js';

type EmbedManyParameters = Parameters<typeof embedMany>[0];

// Every SDK call option except the model, which the registry resolves, the values, which are
// required, and providerOptions, which the requested width owns.
export type EmbedTextsOptions = Omit<
  EmbedManyParameters,
  'model' | 'providerOptions' | 'values'
> & {
  // The store is a fixed-width column, so the width is requested rather than left to the model default.
  dimensions: number;
  values: readonly string[];
};

export type EmbeddedTexts = Awaited<ReturnType<typeof embedMany>>;

export function embedTexts(
  registry: AiRegistry,
  modelId: AiModelId,
  options: EmbedTextsOptions,
): Promise<EmbeddedTexts> {
  const { dimensions, values, ...rest } = options;

  return embedMany({
    ...rest,
    model: registry.embeddingModel(modelId),
    // The option is provider scoped, and the model id names the provider that serves it.
    providerOptions: { [providerOfModelId(modelId)]: { dimensions } },
    values: [...values],
  });
}
