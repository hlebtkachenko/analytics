import { Module } from '@nestjs/common';
import { createResourceJwtVerifier, SubjectRateLimiter } from '@bap/security';

import { AccessController } from './access.controller.js';
import { BlobStore, FilesystemBlobStore } from './blobs/blob-store.js';
import { DatabaseMembershipResolver } from './database-membership-resolver.js';
import { DatasetController } from './datasets/dataset.controller.js';
import {
  DatabaseDatasetRepository,
  DatasetRepository,
} from './datasets/dataset-repository.js';
import { DocumentController } from './documents/document.controller.js';
import {
  DatabaseDocumentRepository,
  DocumentRepository,
} from './documents/document-repository.js';
import { PartnerController } from './documents/partner.controller.js';
import {
  DatabasePartnerRepository,
  PartnerRepository,
} from './documents/partner-repository.js';
import { HealthController } from './health.controller.js';
import {
  IngestionQueue,
  PgBossIngestionQueue,
} from './ingestion/ingestion-queue.js';
import { UploadController } from './ingestion/upload.controller.js';
import { InboxController } from './inbox/inbox.controller.js';
import { InboxChannelController } from './inbox/inbox-channel.controller.js';
import { InboxSettingsController } from './inbox/inbox-settings.controller.js';
import {
  DatabaseInboxRepository,
  InboxRepository,
} from './inbox/inbox-repository.js';
import { InboxQueue, PgBossInboxQueue } from './inbox/inbox-queue.js';
import {
  BLOB_QUOTA_BYTES,
  INTAKE_DOMAIN,
  InboxService,
} from './inbox/inbox.service.js';
import { EntityScopeController } from './legal-entities/entity-scope.controller.js';
import { LegalEntityController } from './legal-entities/legal-entity.controller.js';
import {
  DatabaseLegalEntityRepository,
  LegalEntityRepository,
} from './legal-entities/legal-entity-repository.js';
import {
  DatabaseUploadRepository,
  UploadRepository,
} from './ingestion/upload-repository.js';
import { MembershipResolver } from './membership-resolver.js';
import { MetricsController, ServiceMetrics } from './metrics.js';
import { ReadyController } from './ready.controller.js';
import {
  RESOURCE_JWT_VERIFIER,
  ResourceJwtGuard,
} from './resource-jwt.guard.js';
import { loadRuntimeConfiguration } from './runtime-configuration.js';
import {
  SUBJECT_RATE_LIMITER,
  SubjectRateLimitGuard,
} from './subject-rate-limit.guard.js';

@Module({
  controllers: [
    AccessController,
    DatasetController,
    DocumentController,
    EntityScopeController,
    HealthController,
    InboxChannelController,
    InboxController,
    InboxSettingsController,
    LegalEntityController,
    MetricsController,
    PartnerController,
    ReadyController,
    UploadController,
  ],
  providers: [
    DatabaseDatasetRepository,
    DatabaseDocumentRepository,
    DatabaseInboxRepository,
    DatabaseLegalEntityRepository,
    DatabaseMembershipResolver,
    DatabasePartnerRepository,
    DatabaseUploadRepository,
    PgBossInboxQueue,
    PgBossIngestionQueue,
    {
      provide: DatasetRepository,
      useExisting: DatabaseDatasetRepository,
    },
    {
      provide: DocumentRepository,
      useExisting: DatabaseDocumentRepository,
    },
    {
      provide: InboxRepository,
      useExisting: DatabaseInboxRepository,
    },
    {
      provide: LegalEntityRepository,
      useExisting: DatabaseLegalEntityRepository,
    },
    {
      provide: PartnerRepository,
      useExisting: DatabasePartnerRepository,
    },
    {
      provide: InboxQueue,
      useExisting: PgBossInboxQueue,
    },
    {
      provide: IngestionQueue,
      useExisting: PgBossIngestionQueue,
    },
    {
      provide: MembershipResolver,
      useExisting: DatabaseMembershipResolver,
    },
    {
      provide: UploadRepository,
      useExisting: DatabaseUploadRepository,
    },
    {
      inject: [MembershipResolver],
      provide: ServiceMetrics,
      useFactory: (memberships: MembershipResolver): ServiceMetrics =>
        new ServiceMetrics(memberships),
    },
    {
      provide: BlobStore,
      useFactory: (): BlobStore =>
        new FilesystemBlobStore(
          loadRuntimeConfiguration(process.env).blob.storageDirectory,
        ),
    },
    {
      provide: BLOB_QUOTA_BYTES,
      useFactory: (): number =>
        loadRuntimeConfiguration(process.env).blob.quotaBytesPerOrganization,
    },
    {
      provide: INTAKE_DOMAIN,
      useFactory: (): string =>
        loadRuntimeConfiguration(process.env).intake.domain,
    },
    InboxService,
    {
      provide: RESOURCE_JWT_VERIFIER,
      useFactory: () => {
        const configuration = loadRuntimeConfiguration(process.env);
        return createResourceJwtVerifier({
          issuer: configuration.issuer,
          jwksUrl: configuration.jwksUrl,
        });
      },
    },
    {
      provide: SUBJECT_RATE_LIMITER,
      useFactory: () => {
        const configuration = loadRuntimeConfiguration(process.env);
        return new SubjectRateLimiter(configuration.rateLimit);
      },
    },
    ResourceJwtGuard,
    SubjectRateLimitGuard,
  ],
})
export class AppModule {}
