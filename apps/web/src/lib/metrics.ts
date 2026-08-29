import { collectDefaultMetrics, Registry } from '@prometheus-io/client';

const registry = new Registry();

collectDefaultMetrics({ register: registry });

export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}
