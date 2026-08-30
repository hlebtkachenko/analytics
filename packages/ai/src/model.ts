import { generateText, streamText, type ToolSet } from 'ai';
import type { AiModelId, AiRegistry } from './registry.js';

type GenerateTextParameters<TOOLS extends ToolSet> = Parameters<
  typeof generateText<TOOLS>
>[0];

type StreamTextParameters<TOOLS extends ToolSet> = Parameters<
  typeof streamText<TOOLS>
>[0];

// Every SDK call option except the model, which the registry resolves.
export type GenerateModelTextOptions<TOOLS extends ToolSet> = Omit<
  GenerateTextParameters<TOOLS>,
  'model'
>;

export type StreamModelTextOptions<TOOLS extends ToolSet> = Omit<
  StreamTextParameters<TOOLS>,
  'model'
>;

export function generateModelText<TOOLS extends ToolSet>(
  registry: AiRegistry,
  modelId: AiModelId,
  options: GenerateModelTextOptions<TOOLS>,
): ReturnType<typeof generateText<TOOLS>> {
  // Omit widens the SDK option intersection, so the completed call is asserted back.
  return generateText<TOOLS>({
    ...options,
    model: registry.languageModel(modelId),
  } as GenerateTextParameters<TOOLS>);
}

export function streamModelText<TOOLS extends ToolSet>(
  registry: AiRegistry,
  modelId: AiModelId,
  options: StreamModelTextOptions<TOOLS>,
): ReturnType<typeof streamText<TOOLS>> {
  // Omit widens the SDK option intersection, so the completed call is asserted back.
  return streamText<TOOLS>({
    ...options,
    model: registry.languageModel(modelId),
  } as StreamTextParameters<TOOLS>);
}
