import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

const databaseRoles = [
  'bap_auth',
  'bap_api',
  'bap_backup',
  'bap_migrator',
  'bap_reporting',
] as const;

const databaseUsers = [...databaseRoles, 'postgres'] as const;

const environmentSchema = z.object({
  BAP_DATABASE_HOST: z.string().min(1),
  BAP_DATABASE_NAME: z.string().min(1),
  BAP_DATABASE_PASSWORD_FILE: z.string().min(1),
  BAP_DATABASE_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65_535))
    .optional(),
  BAP_DATABASE_SSL: z.enum(['true', 'false']).optional(),
  BAP_DATABASE_USER: z.enum(databaseUsers),
  BAP_API_PASSWORD_FILE: z.string().min(1).optional(),
  BAP_AUTH_PASSWORD_FILE: z.string().min(1).optional(),
  BAP_BACKUP_PASSWORD_FILE: z.string().min(1).optional(),
  BAP_MIGRATOR_PASSWORD_FILE: z.string().min(1).optional(),
  BAP_REPORTING_PASSWORD_FILE: z.string().min(1).optional(),
});

export type DatabaseRole = (typeof databaseUsers)[number];
export type LoginDatabaseRole = (typeof databaseRoles)[number];

export interface DatabaseConfiguration {
  database: string;
  host: string;
  password: string;
  port: number;
  role: DatabaseRole;
  ssl: boolean;
  user: DatabaseRole;
}

export interface LoadDatabaseConfigurationOptions {
  defaultUser?: DatabaseRole;
  role?: DatabaseRole;
}

export type RoleBootstrapPasswords = Record<LoginDatabaseRole, string>;

type Environment = Record<string, string | undefined>;

type BootstrapPasswordFileKey =
  | 'BAP_API_PASSWORD_FILE'
  | 'BAP_AUTH_PASSWORD_FILE'
  | 'BAP_BACKUP_PASSWORD_FILE'
  | 'BAP_MIGRATOR_PASSWORD_FILE'
  | 'BAP_REPORTING_PASSWORD_FILE';

const bootstrapPasswordFiles: Record<
  LoginDatabaseRole,
  BootstrapPasswordFileKey
> = {
  bap_api: 'BAP_API_PASSWORD_FILE',
  bap_auth: 'BAP_AUTH_PASSWORD_FILE',
  bap_backup: 'BAP_BACKUP_PASSWORD_FILE',
  bap_migrator: 'BAP_MIGRATOR_PASSWORD_FILE',
  bap_reporting: 'BAP_REPORTING_PASSWORD_FILE',
};

async function readPasswordFile(path: string, label: string): Promise<string> {
  const details = await stat(path);

  const permissions = details.mode & 0o777;

  if (!details.isFile() || ![0o400, 0o444, 0o600].includes(permissions)) {
    throw new Error(
      `Password file for ${label} must be a protected regular file.`,
    );
  }

  const content = await readFile(path, 'utf8');
  const password = content.replace(/\r?\n$/, '');

  if (password.length === 0) {
    throw new Error(`Password file for ${label} is empty.`);
  }

  return password;
}

export async function loadDatabaseConfiguration(
  env: Environment,
  options: LoadDatabaseConfigurationOptions = {},
): Promise<DatabaseConfiguration> {
  const parsed = environmentSchema.parse(env);
  const expectedRole = options.role ?? options.defaultUser;

  if (expectedRole !== undefined && parsed.BAP_DATABASE_USER !== expectedRole) {
    throw new Error(
      'BAP_DATABASE_USER does not match the requested database role.',
    );
  }

  return {
    database: parsed.BAP_DATABASE_NAME,
    host: parsed.BAP_DATABASE_HOST,
    password: await readPasswordFile(
      parsed.BAP_DATABASE_PASSWORD_FILE,
      parsed.BAP_DATABASE_USER,
    ),
    port: parsed.BAP_DATABASE_PORT ?? 5432,
    role: parsed.BAP_DATABASE_USER,
    ssl: parsed.BAP_DATABASE_SSL === 'true',
    user: parsed.BAP_DATABASE_USER,
  };
}

export async function loadRoleBootstrapPasswords(
  env: Environment,
): Promise<RoleBootstrapPasswords> {
  const parsed = environmentSchema.parse(env);
  const entries = await Promise.all(
    databaseRoles.map(async (role) => {
      const passwordFile = parsed[bootstrapPasswordFiles[role]];

      if (passwordFile === undefined) {
        throw new Error(`Missing password file for ${role}.`);
      }

      return [role, await readPasswordFile(passwordFile, role)] as const;
    }),
  );

  return Object.fromEntries(entries) as RoleBootstrapPasswords;
}
