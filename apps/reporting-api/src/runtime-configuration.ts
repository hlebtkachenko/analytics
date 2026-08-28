import { z } from 'zod';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3002;

const runtimeConfigurationSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
});

export type RuntimeConfiguration = z.infer<typeof runtimeConfigurationSchema>;

export function loadRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): RuntimeConfiguration {
  const result = runtimeConfigurationSchema.safeParse({
    host: environment.HOST ?? DEFAULT_HOST,
    port: environment.PORT ?? DEFAULT_PORT,
  });

  if (!result.success) {
    throw new Error('Invalid runtime configuration');
  }

  return result.data;
}
