import { createAiRegistry, loadAiConfiguration } from '@bap/ai';
import type { AiRegistry } from '@bap/ai';

type Environment = Record<string, string | undefined>;

export type AiRegistryProvider = () => Promise<AiRegistry>;

// Built on first use, like the ingestion queue client, so the worker still boots without a usable credential.
// A missing or placeholder credential then fails one agent job loudly instead of killing every queue at startup.
export function createLazyAiRegistry(
  environment: Environment,
): AiRegistryProvider {
  let pending: Promise<AiRegistry> | undefined;

  return () => {
    if (pending === undefined) {
      const started = loadAiConfiguration(environment).then((configuration) =>
        createAiRegistry(configuration),
      );
      pending = started;
      // A failed load is dropped, so the next job retries instead of replaying the rejection forever.
      void started.catch(() => {
        if (pending === started) {
          pending = undefined;
        }
      });
    }

    return pending;
  };
}
