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
import { HrController } from './hr/hr.controller.js';
import { HrTimeController } from './hr-time/hr-time.controller.js';
import { HrSelfServiceController } from './hr-self-service/hr-self-service.controller.js';
import {
  DatabaseHrSelfServiceRepository,
  HrSelfServiceRepository,
} from './hr-self-service/hr-self-service-repository.js';
import {
  DatabaseHrTimeRepository,
  HrTimeRepository,
} from './hr-time/hr-time-repository.js';
import { PayrollController } from './payroll/payroll.controller.js';
import {
  DatabasePayrollRepository,
  PayrollRepository,
} from './payroll/payroll-repository.js';
import { HrAccessController } from './hr/access.controller.js';
import {
  DatabaseHrAccessRepository,
  HrAccessRepository,
} from './hr/access-repository.js';
import { DatabaseHrRepository, HrRepository } from './hr/hr-repository.js';
import { ReferenceController } from './hr/reference.controller.js';
import {
  DatabaseReferenceRepository,
  ReferenceRepository,
} from './hr/reference-repository.js';
import {
  IngestionQueue,
  PgBossIngestionQueue,
} from './ingestion/ingestion-queue.js';
import { UploadController } from './ingestion/upload.controller.js';
import { InboxController } from './inbox/inbox.controller.js';
import { InboxChannelController } from './inbox/inbox-channel.controller.js';
import { InboxRulesController } from './inbox/inbox-rules.controller.js';
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
import { PayrollImportController } from './payroll-import/payroll-import.controller.js';
import {
  DatabasePayrollImportRepository,
  PayrollImportRepository,
} from './payroll-import/payroll-import-repository.js';
import {
  PayrollImportQueue,
  PgBossPayrollImportQueue,
} from './payroll-import/payroll-import-queue.js';
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
    InboxRulesController,
    InboxSettingsController,
    HrController,
    HrTimeController,
    HrSelfServiceController,
    PayrollController,
    HrAccessController,
    ReferenceController,
    LegalEntityController,
    MetricsController,
    PartnerController,
    ReadyController,
    UploadController,
    PayrollImportController,
  ],
  providers: [
    DatabaseDatasetRepository,
    DatabaseDocumentRepository,
    DatabaseInboxRepository,
    DatabaseLegalEntityRepository,
    DatabaseHrRepository,
    DatabaseHrTimeRepository,
    DatabaseHrSelfServiceRepository,
    DatabasePayrollRepository,
    DatabaseHrAccessRepository,
    DatabaseReferenceRepository,
    DatabaseMembershipResolver,
    DatabasePartnerRepository,
    DatabaseUploadRepository,
    PgBossInboxQueue,
    DatabasePayrollImportRepository,
    PgBossPayrollImportQueue,
    PgBossIngestionQueue,
    {
      provide: HrRepository,
      useExisting: DatabaseHrRepository,
    },
    {
      provide: HrTimeRepository,
      useExisting: DatabaseHrTimeRepository,
    },
    {
      provide: HrSelfServiceRepository,
      useExisting: DatabaseHrSelfServiceRepository,
    },
    {
      provide: PayrollRepository,
      useExisting: DatabasePayrollRepository,
    },
    {
      provide: HrAccessRepository,
      useExisting: DatabaseHrAccessRepository,
    },
    {
      provide: ReferenceRepository,
      useExisting: DatabaseReferenceRepository,
    },
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
      provide: PayrollImportRepository,
      useExisting: DatabasePayrollImportRepository,
    },
    { provide: PayrollImportQueue, useExisting: PgBossPayrollImportQueue },
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
