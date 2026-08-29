import {
  bootstrapDatabaseRoles,
  createDatabasePool,
  loadDatabaseConfiguration,
  loadRoleBootstrapPasswords,
  runMigrations,
} from './index.js';

async function bootstrapRoles(): Promise<void> {
  const env = process.env;
  const admin = createDatabasePool(
    await loadDatabaseConfiguration(env, { role: 'postgres' }),
  );

  try {
    const passwords = await loadRoleBootstrapPasswords(env);
    const client = await admin.connect();

    try {
      await bootstrapDatabaseRoles(client, passwords);
    } finally {
      client.release();
    }
  } finally {
    await admin.end();
  }
}

async function migrate(): Promise<void> {
  const pool = createDatabasePool(
    await loadDatabaseConfiguration(process.env, { role: 'bap_migrator' }),
  );

  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

const command = process.argv[2];

if (command === 'bootstrap-roles') {
  await bootstrapRoles();
} else if (command === 'migrate') {
  await migrate();
} else {
  throw new Error('Expected bootstrap-roles or migrate.');
}
