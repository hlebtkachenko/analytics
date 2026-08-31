import { createInterface } from 'node:readline/promises';
import { stdin, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

import type { DatabasePool } from '@bap/db';

import { getAuth, getAuthPool } from '../lib/auth/server.js';
import { resolveBootstrapState } from '../lib/auth/bootstrap-owner.js';
import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
} from '../lib/organizations/slug.js';
import { seedInitialOrganizationQuotaForCli } from './organization-quota.js';

type BootstrapRow = Readonly<{
  email_verified: boolean;
  has_membership: boolean;
  id: string;
  role: string;
}>;

type BootstrapOwnerInput = Readonly<{
  email: string;
  name: string;
  organizationName: string;
  password: string;
}>;

type BootstrapAuth = Readonly<{
  api: Readonly<{
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<{ id: string }>;
    createUser: (input: {
      body: {
        data: { emailVerified: true };
        email: string;
        name: string;
        password: string;
        role: 'admin';
      };
    }) => Promise<{ user: { id: string } }>;
  }>;
}>;

export interface BootstrapOwnerDependencies {
  getAuth: () => Promise<BootstrapAuth>;
  getAuthPool: () => Promise<DatabasePool>;
  readInput: () => Promise<BootstrapOwnerInput>;
  seedQuota: (userId: string) => Promise<void>;
}

async function promptPassword(): Promise<string> {
  stdout.write('Owner password: ');
  return await new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', receive);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const receive = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u0003') {
          finish(new Error('Bootstrap cancelled.'));
          return;
        }
        if (character === '\u007f') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', receive);
  });
}

async function readBootstrapOwnerInput(): Promise<BootstrapOwnerInput> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('bootstrap-owner requires an interactive TTY.');
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  const email = (await terminal.question('Confirmed owner email: ')).trim();
  const name = (await terminal.question('Owner display name: ')).trim();
  const organizationName = (
    await terminal.question('Organization name: ')
  ).trim();
  terminal.close();
  const password = await promptPassword();
  return { email, name, organizationName, password };
}

const defaultDependencies: BootstrapOwnerDependencies = {
  getAuth,
  getAuthPool,
  readInput: readBootstrapOwnerInput,
  seedQuota: seedInitialOrganizationQuotaForCli,
};

export async function bootstrapOwner(
  dependencies: BootstrapOwnerDependencies = defaultDependencies,
): Promise<Readonly<{ organizationId: string; userId: string }>> {
  const input = await dependencies.readInput();
  const email = input.email.trim();
  const name = input.name.trim();
  const organizationName = input.organizationName.trim();
  const password = input.password;
  const slug = normalizeOrganizationSlug(organizationName);
  const validSlug = organizationSlugSchema.safeParse(slug);

  if (
    !email ||
    !name ||
    !organizationName ||
    !validSlug.success ||
    password.length < 14 ||
    password.length > 128
  ) {
    throw new Error(
      'Provide confirmed owner details and a 14-128 character password.',
    );
  }

  const pool = await dependencies.getAuthPool();
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('bap.bootstrap-owner'))",
    );
    locked = true;
    const owner = await client.query<{ has_owner: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM auth.member WHERE 'owner' = ANY(string_to_array(role, ','))) AS has_owner",
    );
    const user = await client.query<BootstrapRow>(
      'SELECT u.id, u.role, u.email_verified, EXISTS (SELECT 1 FROM auth.member m WHERE m.user_id = u.id) AS has_membership FROM auth."user" u WHERE u.email = $1',
      [email],
    );
    const current = user.rows[0];
    const state = resolveBootstrapState({
      hasOwner: owner.rows[0]?.has_owner === true,
      user: current
        ? {
            emailVerified: current.email_verified,
            hasMembership: current.has_membership,
            id: current.id,
            role: current.role,
          }
        : null,
    });
    if (state === 'abort_existing_owner' || state === 'abort_partial_state') {
      throw new Error(
        'Bootstrap cannot continue. Use the documented recovery procedure.',
      );
    }

    const auth = await dependencies.getAuth();
    const userId =
      current?.id ??
      (
        await auth.api.createUser({
          body: {
            data: { emailVerified: true },
            email,
            name,
            password,
            role: 'admin',
          },
        })
      ).user.id;
    await dependencies.seedQuota(userId);
    const organization = await auth.api.createOrganization({
      body: { name: organizationName, slug: validSlug.data, userId },
    });
    return { organizationId: organization.id, userId };
  } finally {
    try {
      if (locked) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('bap.bootstrap-owner'))",
        );
      }
    } finally {
      client.release();
    }
  }
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void bootstrapOwner()
    .then((result) => {
      stdout.write(`${JSON.stringify({ status: 'completed', ...result })}\n`);
    })
    .catch(() => {
      stderr.write('Bootstrap failed.\n');
      process.exitCode = 1;
    });
}
