import type { LanguageModelUsage } from 'ai';

export type ModelCallOutcome = 'error' | 'success';

export interface ModelCallReport {
  finishReason?: string | undefined;
  modelId: string;
  outcome: ModelCallOutcome;
  usage?: LanguageModelUsage | undefined;
}

export interface ModelCallAudit {
  finishReason: string | undefined;
  inputTokens: number | undefined;
  modelId: string;
  outcome: ModelCallOutcome;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}

// Audit rows are read across the organization, so no prompt or completion content is copied.
export function describeModelCall(call: ModelCallReport): ModelCallAudit {
  return {
    finishReason: call.finishReason,
    inputTokens: call.usage?.inputTokens,
    modelId: call.modelId,
    outcome: call.outcome,
    outputTokens: call.usage?.outputTokens,
    totalTokens: call.usage?.totalTokens,
  };
}
