import { stdin, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { getAuth } from '../lib/auth/server.js';

const syntheticAccountSchema = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(256),
    organizationName: z.string().trim().min(1).max(256),
    organizationSlug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    password: z.string().min(14).max(128),
  })
  .strict();

export type SyntheticAccountInput = z.infer<typeof syntheticAccountSchema>;

type SyntheticAuth = Readonly<{
  api: Readonly<{
    createOrganization: (
      input: Readonly<{
        body: Readonly<{ name: string; slug: string; userId: string }>;
      }>,
    ) => Promise<Readonly<{ id: string }>>;
    createUser: (
      input: Readonly<{
        body: Readonly<{
          data: Readonly<{ emailVerified: boolean }>;
          email: string;
          name: string;
          password: string;
        }>;
      }>,
    ) => Promise<Readonly<{ user: Readonly<{ id: string }> }>>;
  }>;
}>;

type SyntheticAccountResult = Readonly<{
  organizationId: string;
  userId: string;
}>;

type SyntheticCliOutput = Readonly<{
  write: (value: string) => boolean;
}>;

export function assertSyntheticSetupEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment.BAP_E2E_SETUP !== 'true') {
    throw new Error('Synthetic account setup is disabled.');
  }
}

export function parseSyntheticAccountInput(
  value: string,
): SyntheticAccountInput {
  try {
    return syntheticAccountSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('Invalid synthetic account input.');
  }
}

export async function readSyntheticAccountInput(
  input: AsyncIterable<string | Uint8Array>,
): Promise<SyntheticAccountInput> {
  let value = '';
  for await (const chunk of input) {
    value += Buffer.from(chunk).toString('utf8');
    if (value.length > 16_384) {
      throw new Error('Invalid synthetic account input.');
    }
  }
  return parseSyntheticAccountInput(value);
}

export async function createSyntheticAccount(
  input: SyntheticAccountInput,
  auth: SyntheticAuth,
): Promise<SyntheticAccountResult> {
  const user = await auth.api.createUser({
    body: {
      data: { emailVerified: true },
      email: input.email,
      name: input.name,
      password: input.password,
    },
  });
  const organization = await auth.api.createOrganization({
    body: {
      name: input.organizationName,
      slug: input.organizationSlug,
      userId: user.user.id,
    },
  });
  return { organizationId: organization.id, userId: user.user.id };
}

export function formatSyntheticAccountResult(
  result: SyntheticAccountResult,
): string {
  return `${JSON.stringify({ status: 'created', ...result })}\n`;
}

export async function runSyntheticAccountCli(
  input: AsyncIterable<string | Uint8Array>,
  output: SyntheticCliOutput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  loadAuth: () => Promise<SyntheticAuth> = getAuth,
): Promise<void> {
  assertSyntheticSetupEnabled(environment);
  const account = await readSyntheticAccountInput(input);
  const result = await createSyntheticAccount(account, await loadAuth());
  output.write(formatSyntheticAccountResult(result));
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runSyntheticAccountCli(stdin, stdout).catch(() => {
    stderr.write('Synthetic account setup failed.\n');
    process.exitCode = 1;
  });
}
