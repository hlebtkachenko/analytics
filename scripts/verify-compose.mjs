import { readFileSync } from 'node:fs';

const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const configuration = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const mode = process.argv[2];
const backupEntrypoint = readFileSync(
  new URL('./backup-entrypoint.sh', import.meta.url),
  'utf8',
);
const backupStageEntrypoint = readFileSync(
  new URL('./backup-stage-entrypoint.sh', import.meta.url),
  'utf8',
);
const caddyfile = readFileSync(
  new URL('../infrastructure/caddy/Caddyfile', import.meta.url),
  'utf8',
);
const mailpitCaddyfile = readFileSync(
  new URL('../infrastructure/caddy/MailpitApi.Caddyfile', import.meta.url),
  'utf8',
);
const developmentCompose = readFileSync(
  new URL('../compose.development.yaml', import.meta.url),
  'utf8',
);

// pgvector ships the pinned PostgreSQL 18.6 build plus the vector extension.
const postgresImageDigest =
  'sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
const mailpitImageDigest =
  'sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function names(values = []) {
  return values.map((value) => value.source).sort();
}

function networkNames(service) {
  return Object.keys(configuration.services[service]?.networks ?? {}).sort();
}

function expectSecrets(service, expected) {
  invariant(
    JSON.stringify(names(configuration.services[service]?.secrets)) ===
      JSON.stringify([...expected].sort()),
    `Unexpected credentials for ${service}.`,
  );
}

invariant(
  !/(^|\s)(eval|source)\s/m.test(
    `${backupStageEntrypoint}\n${backupEntrypoint}`,
  ) &&
    !backupStageEntrypoint.includes('RESTIC_BACKEND_CREDENTIALS') &&
    !backupEntrypoint.includes('RESTIC_BACKEND_CREDENTIALS'),
  'The backup entrypoint must not execute generic credential input.',
);
invariant(
  !/mailpit/i.test(caddyfile),
  'Caddy must not expose the development mail sink.',
);
invariant(
  mailpitCaddyfile.replace(/\s+/g, ' ').trim() ===
    '{ admin off auto_https off } :8025 { @allowed { method GET path /readyz /api/v1/search } handle @allowed { reverse_proxy mailpit:8025 } respond 404 }',
  'The Mailpit API proxy must retain its exact GET-only allowlist.',
);
invariant(
  !/mailpit|BAP_MAIL_SMTP_|BAP_MAIL_TRANSPORT:\s*smtp/i.test(
    developmentCompose,
  ),
  'The development overlay must not contain the optional mail sink.',
);
invariant(
  ['development', 'production', 'operations', 'bootstrap'].includes(mode),
  'Unknown Compose verification mode.',
);

const applicationServices = ['web', 'api', 'reporting-api', 'worker'];

for (const service of applicationServices) {
  invariant(
    configuration.services[service].healthcheck.test
      .join(' ')
      .includes('/ready'),
    `${service} must use readiness health checks.`,
  );
}

invariant(
  networkNames('database').join() === 'data',
  'PostgreSQL must use only the data network.',
);
invariant(
  networkNames('caddy').join() === 'app,edge',
  'Caddy must use only edge and app networks.',
);
invariant(
  configuration.services.database.image.includes(postgresImageDigest),
  'PostgreSQL image must use the accepted pgvector digest.',
);
invariant(
  configuration.services.caddy.image.includes(
    'sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648',
  ),
  'Caddy image must use the accepted digest.',
);

// Only services with a justified provider dependency may reach the internet.
const internetEgressMembers = Object.entries(configuration.services)
  .filter(([, service]) =>
    Object.hasOwn(service.networks ?? {}, 'internet-egress'),
  )
  .map(([name]) => name)
  .sort();
invariant(
  internetEgressMembers.join() === 'web,worker',
  `Unexpected internet egress members: ${internetEgressMembers.join(',')}.`,
);
invariant(
  configuration.networks['internet-egress'].internal !== true,
  'The internet egress network must permit outbound access.',
);
for (const service of ['api', 'reporting-api']) {
  invariant(
    !Object.hasOwn(
      configuration.services[service].networks ?? {},
      'internet-egress',
    ),
    `${service} must not join the internet egress network.`,
  );
}
// Egress must attach first and own the default route out of every member.
for (const service of internetEgressMembers) {
  const serviceNetworks = configuration.services[service].networks;
  const egress = serviceNetworks['internet-egress'];
  const internalNames = Object.keys(serviceNetworks).filter(
    (name) => name !== 'internet-egress',
  );
  invariant(
    internalNames.every(
      (name) =>
        egress?.priority > (serviceNetworks[name]?.priority ?? 0) &&
        egress?.gw_priority > (serviceNetworks[name]?.gw_priority ?? 0),
    ),
    `${service} must attach internet egress first and take its default route from it.`,
  );
}

invariant(
  networkNames('worker').join() === 'data,internet-egress',
  'The worker must use only data and internet egress.',
);

// Staged uploads are other tenants' raw files, so the volume's member set is a contract.
const uploadStagingTarget = '/var/lib/bap/uploads';
const uploadStagingMounts = Object.entries(configuration.services).flatMap(
  ([name, service]) =>
    (service.volumes ?? [])
      .filter((mount) => mount.source === 'upload_staging')
      .map((mount) => ({ mount, name })),
);
const uploadStagingMembers = uploadStagingMounts.map(({ name }) => name).sort();
invariant(
  uploadStagingMembers.join() === 'api,worker',
  `Unexpected upload staging members: ${uploadStagingMembers.join(',')}.`,
);
for (const { mount, name } of uploadStagingMounts) {
  invariant(
    mount.type === 'volume' &&
      mount.target === uploadStagingTarget &&
      mount.read_only !== true,
    `${name} must mount the upload staging volume read-write at ${uploadStagingTarget}.`,
  );
}
invariant(
  Object.hasOwn(configuration.volumes, 'upload_staging'),
  'The upload staging volume must be declared.',
);
for (const service of ['api', 'worker']) {
  invariant(
    configuration.services[service].environment.BAP_UPLOAD_STAGING_DIR ===
      uploadStagingTarget,
    `${service} must read staged uploads from the mounted volume.`,
  );
}

expectSecrets('database', ['postgres_admin_password']);
expectSecrets('web', [
  'ai_provider_config',
  'bap_auth_password',
  'better_auth_secret',
  'resend_api_key',
]);
invariant(
  !Object.hasOwn(
    configuration.services.web.environment,
    'BAP_MIGRATOR_PASSWORD_FILE',
  ) &&
    !(configuration.services.web.secrets ?? []).some(
      (secret) => secret.source === 'bap_migrator_password',
    ),
  'Long-lived web must not receive the migrator credential.',
);
expectSecrets('api', ['bap_api_password']);
expectSecrets('reporting-api', ['bap_reporting_password']);
expectSecrets('worker', ['ai_provider_config', 'bap_api_password']);
expectSecrets('migrator', ['bap_migrator_password']);
expectSecrets('role-bootstrap', [
  'bap_api_password',
  'bap_auth_password',
  'bap_backup_password',
  'bap_migrator_password',
  'bap_reporting_password',
  'postgres_admin_password',
]);

const published = Object.entries(configuration.services)
  .filter(([, service]) => (service.ports?.length ?? 0) > 0)
  .map(([name]) => name)
  .sort();

const publishedHostPorts = new Map();
for (const [serviceName, service] of Object.entries(configuration.services)) {
  for (const port of service.ports ?? []) {
    const hostPort = Number(port.published);
    const protocol = port.protocol ?? 'tcp';
    invariant(
      Number.isInteger(hostPort) && hostPort >= 1 && hostPort <= 65_535,
      `${serviceName} must publish a valid host port.`,
    );
    const key = `${protocol}:${hostPort}`;
    const existingService = publishedHostPorts.get(key);
    invariant(
      existingService === undefined,
      `Published ${protocol.toUpperCase()} host port ${hostPort} is reused by ${existingService} and ${serviceName}.`,
    );
    publishedHostPorts.set(key, serviceName);
  }
}

function expectMailpitAbsent(label) {
  invariant(
    !Object.hasOwn(configuration.services, 'mailpit') &&
      !Object.hasOwn(configuration.services, 'mailpit-api-proxy') &&
      !Object.hasOwn(configuration.networks, 'mailpit-loopback') &&
      configuration.services.web.environment.BAP_MAIL_TRANSPORT !== 'smtp' &&
      !Object.keys(configuration.services.web.environment).some((name) =>
        name.startsWith('BAP_MAIL_SMTP_'),
      ) &&
      !Object.values(configuration.services).some((service) =>
        (service.ports ?? []).some((port) => port.target === 8025),
      ),
    `${label} must exclude the Mailpit overlay and SMTP configuration.`,
  );
}

if (['production', 'operations', 'bootstrap'].includes(mode)) {
  expectMailpitAbsent(mode);
}

if (mode === 'production') {
  invariant(
    published.join() === 'caddy',
    'Only Caddy may publish production ports.',
  );
  invariant(
    configuration.networks.app.internal,
    'The app network must be internal.',
  );
  invariant(
    configuration.networks.data.internal,
    'The data network must be internal.',
  );

  for (const service of applicationServices) {
    const model = configuration.services[service];
    invariant(
      model.read_only === true &&
        model.cap_drop.join() === 'ALL' &&
        model.security_opt.join() === 'no-new-privileges:true' &&
        model.restart === 'unless-stopped',
      `${service} must retain the production privilege boundary.`,
    );
    invariant(
      model.tmpfs.includes('/tmp'),
      `${service} must write only to ephemeral storage.`,
    );
    // Staging is the one durable exception, and only the pair that parses uploads holds it.
    const durable = (model.volumes ?? []).map((mount) => mount.source).sort();
    invariant(
      durable.join() ===
        (service === 'api' || service === 'worker' ? 'upload_staging' : ''),
      `${service} must keep the production durable mount set.`,
    );
  }
}

if (mode === 'development') {
  invariant(
    published.join() === 'caddy,database,mailpit-api-proxy',
    'Development may publish only Caddy, PostgreSQL, and the Mailpit API proxy.',
  );
  const mailpit = configuration.services.mailpit;
  invariant(
    mailpit.image.includes(mailpitImageDigest),
    'Mailpit must use the accepted image digest.',
  );
  invariant(
    networkNames('mailpit').join() === 'app',
    'Mailpit must use only the app network.',
  );
  invariant(
    mailpit.expose.join() === '1025' && (mailpit.ports?.length ?? 0) === 0,
    'Mailpit SMTP must remain internal to Docker.',
  );
  invariant(
    mailpit.healthcheck.test.join(' ').includes('/readyz'),
    'Mailpit must use its readiness endpoint.',
  );
  invariant(
    mailpit.read_only === true &&
      mailpit.user === '10001:10001' &&
      mailpit.cap_drop.join() === 'ALL' &&
      (mailpit.cap_add?.length ?? 0) === 0 &&
      mailpit.security_opt.join() === 'no-new-privileges:true' &&
      mailpit.tmpfs.length === 1,
    'Mailpit must retain the development sink privilege boundary.',
  );
  const mailpitApiProxy = configuration.services['mailpit-api-proxy'];
  const [mailpitApiPort] = mailpitApiProxy.ports;
  const mailpitApiConfigMount = mailpitApiProxy.volumes.find(
    (mount) => mount.target === '/etc/caddy/Caddyfile',
  );
  invariant(
    mailpitApiProxy.image.includes(
      'sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648',
    ) &&
      networkNames('mailpit-api-proxy').join() === 'app,mailpit-loopback' &&
      mailpitApiProxy.ports.length === 1 &&
      mailpitApiPort.host_ip === '127.0.0.1' &&
      mailpitApiPort.target === 8025 &&
      mailpitApiPort.protocol === 'tcp' &&
      mailpitApiProxy.depends_on.mailpit.condition === 'service_healthy',
    'The Mailpit HTTP proxy must be loopback-only and wait for the sink.',
  );
  invariant(
    JSON.stringify(mailpitApiProxy.command) ===
      JSON.stringify([
        '/bin/sh',
        '-eu',
        '-c',
        'cp /usr/bin/caddy /run/caddy/caddy && exec /run/caddy/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
      ]) &&
      mailpitApiConfigMount?.type === 'bind' &&
      mailpitApiConfigMount.read_only === true &&
      mailpitApiConfigMount.source.endsWith(
        '/infrastructure/caddy/MailpitApi.Caddyfile',
      ),
    'The Mailpit HTTP proxy must run only the mounted allowlist configuration.',
  );
  invariant(
    mailpitApiProxy.healthcheck.test.join(' ').includes('/readyz'),
    'The Mailpit HTTP proxy must verify the sink readiness path.',
  );
  invariant(
    mailpitApiProxy.read_only === true &&
      mailpitApiProxy.user === '10001:10001' &&
      mailpitApiProxy.cap_drop.join() === 'ALL' &&
      (mailpitApiProxy.cap_add?.length ?? 0) === 0 &&
      mailpitApiProxy.security_opt.join() === 'no-new-privileges:true' &&
      mailpitApiProxy.tmpfs.length === 2 &&
      mailpitApiProxy.tmpfs.some(
        (mount) =>
          mount.startsWith('/run/caddy:') &&
          mount.includes('exec') &&
          mount.includes('nosuid') &&
          mount.includes('nodev') &&
          mount.includes('size=64m'),
      ),
    'The Mailpit HTTP proxy must retain its development privilege boundary.',
  );
  invariant(
    configuration.networks['mailpit-loopback'].internal !== true,
    'The Mailpit HTTP proxy network must permit host loopback publishing.',
  );
  invariant(
    configuration.services.web.environment.BAP_MAIL_TRANSPORT === 'smtp' &&
      configuration.services.web.environment.BAP_MAIL_SMTP_HOST === 'mailpit' &&
      configuration.services.web.environment.BAP_MAIL_SMTP_PORT === '1025' &&
      configuration.services.web.depends_on.mailpit.condition ===
        'service_healthy',
    'Development web must wait for and use the internal Mailpit SMTP sink.',
  );
}

if (mode === 'operations') {
  expectSecrets('backup', [
    'bap_backup_password',
    'restic_password',
    'restic_repository',
  ]);
  expectSecrets('restore', [
    'bap_migrator_password',
    'restic_password',
    'restic_repository',
  ]);
  expectSecrets('backup-check', ['restic_password', 'restic_repository']);
  invariant(
    configuration.networks.data.internal === true,
    'The operations model must retain the internal data network.',
  );
  invariant(
    configuration.networks['operations-egress'].internal !== true,
    'The operations egress network must permit outbound access.',
  );
  invariant(
    networkNames('backup').join() === 'data,operations-egress',
    'Backup must use only data and operations egress.',
  );
  invariant(
    networkNames('restore').join() === 'data,operations-egress',
    'Restore must use only data and operations egress.',
  );
  for (const service of ['backup-check', 'backup-init', 'backup-prune']) {
    invariant(
      networkNames(service).join() === 'operations-egress',
      `${service} must use only operations egress.`,
    );
  }
  for (const service of [
    'backup',
    'backup-check',
    'backup-init',
    'backup-prune',
    'restore',
  ]) {
    const model = configuration.services[service];
    const operationEnvironment = model.environment ?? {};
    invariant(
      model.read_only === true &&
        model.cap_drop.join() === 'ALL' &&
        [...model.cap_add].sort().join() ===
          'CHOWN,DAC_READ_SEARCH,SETGID,SETUID' &&
        model.security_opt.join() === 'no-new-privileges:true',
      `${service} must retain the staging privilege boundary.`,
    );
    invariant(
      JSON.stringify([...model.tmpfs].sort()) ===
        JSON.stringify(
          [
            '/tmp',
            '/run/bap-credentials:rw,noexec,nosuid,nodev,size=64k,mode=0750,uid=0,gid=999',
          ].sort(),
        ),
      `${service} must use only ephemeral credential staging.`,
    );
    invariant(
      !Object.hasOwn(operationEnvironment, 'BAP_DATABASE_PASSWORD_FILE') &&
        !Object.hasOwn(operationEnvironment, 'BAP_DATABASE_USER') &&
        !Object.hasOwn(operationEnvironment, 'PGPASSWORD') &&
        !Object.hasOwn(operationEnvironment, 'RESTIC_PASSWORD_FILE') &&
        !Object.hasOwn(operationEnvironment, 'RESTIC_REPOSITORY_FILE'),
      `${service} must use fixed credential paths and database roles.`,
    );
  }
  for (const service of ['restore-database', 'restore-role-bootstrap']) {
    invariant(
      networkNames(service).join() === 'data',
      `${service} must use only the data network.`,
    );
  }
  invariant(
    configuration.services['restore-database'].image.includes(
      postgresImageDigest,
    ),
    'The restore database image must use the accepted pgvector digest.',
  );
  const operationsMembers = Object.entries(configuration.services)
    .filter(([, service]) =>
      Object.hasOwn(service.networks ?? {}, 'operations-egress'),
    )
    .map(([name]) => name)
    .sort();
  invariant(
    operationsMembers.join() ===
      'backup,backup-check,backup-init,backup-prune,restore',
    `Unexpected operations egress members: ${operationsMembers.join(',')}.`,
  );
  for (const service of operationsMembers) {
    invariant(
      (configuration.services[service].ports?.length ?? 0) === 0,
      `${service} must not publish ports.`,
    );
  }
}

if (mode === 'bootstrap') {
  expectSecrets('bootstrap-owner', [
    'bap_auth_password',
    'bap_migrator_password',
    'better_auth_secret',
  ]);
  invariant(
    configuration.services['bootstrap-owner'].environment.BAP_DATABASE_USER ===
      'bap_auth' &&
      configuration.services['bootstrap-owner'].environment
        .BAP_DATABASE_PASSWORD_FILE === '/run/credentials/database-password' &&
      configuration.services['bootstrap-owner'].environment
        .BAP_MIGRATOR_PASSWORD_FILE === '/run/credentials/migrator-password',
    'Owner bootstrap must keep separate auth and migrator credential boundaries.',
  );
  const authServicesWithMigrator = Object.entries(configuration.services)
    .filter(([, service]) => {
      return (
        service.environment?.BAP_DATABASE_USER === 'bap_auth' &&
        (service.secrets ?? []).some(
          (secret) => secret.source === 'bap_migrator_password',
        )
      );
    })
    .map(([name]) => name)
    .sort();
  invariant(
    authServicesWithMigrator.join() === 'bootstrap-owner',
    'Only the profiled owner bootstrap may combine auth and migrator boundaries.',
  );
  invariant(
    Object.keys(configuration.services['bootstrap-owner'].networks).join() ===
      'data',
    'Owner bootstrap must use only the data network.',
  );
  invariant(
    configuration.services['bootstrap-owner'].stdin_open === true &&
      configuration.services['bootstrap-owner'].tty === true,
    'Owner bootstrap must require an interactive terminal.',
  );
}

process.stdout.write(`Compose ${mode} contract verified.\n`);
