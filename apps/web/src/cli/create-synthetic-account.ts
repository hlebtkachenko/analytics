import { stdin, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { findOrganizationIdBySlug } from '@bap/db/access';
import { z } from 'zod';

import { getAuth, getAuthPool } from '../lib/auth/server.js';
import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
} from '../lib/organizations/slug.js';
import { seedInitialOrganizationQuotaForCli } from './organization-quota.js';

const syntheticAccountShape = {
  email: z.email().max(254),
  name: z.string().trim().min(1).max(256),
  organizationSlug: z.string().trim().min(1).max(256),
  password: z.string().min(14).max(128),
};

// The owner form creates the organization; the member form joins an existing one.
const syntheticOwnerInputSchema = z
  .object({
    ...syntheticAccountShape,
    organizationName: z.string().trim().min(1).max(256),
  })
  .strict();

const syntheticMemberInputSchema = z
  .object({
    ...syntheticAccountShape,
    role: z.enum(['admin', 'member']),
  })
  .strict();

const syntheticAccountInputSchema = z.union([
  syntheticOwnerInputSchema,
  syntheticMemberInputSchema,
]);

export type SyntheticAccountInput = z.infer<typeof syntheticAccountInputSchema>;

type SyntheticAuth = Readonly<{
  api: Readonly<{
    addMember: (
      input: Readonly<{
        body: Readonly<{
          organizationId: string;
          role: 'admin' | 'member';
          userId: string;
        }>;
      }>,
    ) => Promise<unknown>;
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

export type FindSyntheticOrganizationId = (
  organizationSlug: string,
) => Promise<string | null>;

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
    return validateSyntheticAccountInput(JSON.parse(value));
  } catch {
    throw new Error('Invalid synthetic account input.');
  }
}

function validateSyntheticAccountInput(value: unknown): SyntheticAccountInput {
  const parsed = syntheticAccountInputSchema.parse(value);
  const organizationSlug = organizationSlugSchema.parse(
    normalizeOrganizationSlug(parsed.organizationSlug),
  );
  return { ...parsed, organizationSlug };
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

// Reads the organization by slug through the gated auth pool, never a browser-supplied id.
export async function findSyntheticOrganizationId(
  organizationSlug: string,
): Promise<string | null> {
  return await findOrganizationIdBySlug(await getAuthPool(), organizationSlug);
}

async function createVerifiedUser(
  auth: SyntheticAuth,
  account: SyntheticAccountInput,
): Promise<string> {
  const created = await auth.api.createUser({
    body: {
      data: { emailVerified: true },
      email: account.email,
      name: account.name,
      password: account.password,
    },
  });
  return created.user.id;
}

export async function createSyntheticAccount(
  input: SyntheticAccountInput,
  auth: SyntheticAuth,
  seedQuota: (userId: string) => Promise<void>,
  findOrganizationId: FindSyntheticOrganizationId,
): Promise<SyntheticAccountResult> {
  const validated = validateSyntheticAccountInput(input);

  if ('role' in validated) {
    // The organization is resolved before any user write, so an unknown slug stays side-effect free.
    const organizationId = await findOrganizationId(validated.organizationSlug);
    if (organizationId === null) {
      throw new Error('Invalid synthetic account input.');
    }

    const userId = await createVerifiedUser(auth, validated);
    await auth.api.addMember({
      body: { organizationId, role: validated.role, userId },
    });
    return { organizationId, userId };
  }

  const userId = await createVerifiedUser(auth, validated);
  await seedQuota(userId);
  const organization = await auth.api.createOrganization({
    body: {
      name: validated.organizationName,
      slug: validated.organizationSlug,
      userId,
    },
  });
  return { organizationId: organization.id, userId };
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
  seedQuota: (
    userId: string,
  ) => Promise<void> = seedInitialOrganizationQuotaForCli,
  findOrganizationId: FindSyntheticOrganizationId = findSyntheticOrganizationId,
): Promise<void> {
  assertSyntheticSetupEnabled(environment);
  const account = await readSyntheticAccountInput(input);
  const result = await createSyntheticAccount(
    account,
    await loadAuth(),
    seedQuota,
    findOrganizationId,
  );
  output.write(formatSyntheticAccountResult(result));
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void runSyntheticAccountCli(stdin, stdout).catch(() => {
    stderr.write('Synthetic account setup failed.\n');
    process.exitCode = 1;
  });
}
