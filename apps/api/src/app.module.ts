import { Module } from '@nestjs/common';
import { createResourceJwtVerifier, SubjectRateLimiter } from '@bap/security';

import { AccessController } from './access.controller.js';
import { DatabaseMembershipResolver } from './database-membership-resolver.js';
import { DatasetController } from './datasets/dataset.controller.js';
import {
  DatabaseDatasetRepository,
  DatasetRepository,
} from './datasets/dataset-repository.js';
import { HealthController } from './health.controller.js';
import {
  IngestionQueue,
  PgBossIngestionQueue,
} from './ingestion/ingestion-queue.js';
import { UploadController } from './ingestion/upload.controller.js';
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
    EntityScopeController,
    HealthController,
    LegalEntityController,
    MetricsController,
    ReadyController,
    UploadController,
  ],
  providers: [
    DatabaseDatasetRepository,
    DatabaseLegalEntityRepository,
    DatabaseMembershipResolver,
    DatabaseUploadRepository,
    PgBossIngestionQueue,
    {
      provide: DatasetRepository,
      useExisting: DatabaseDatasetRepository,
    },
    {
      provide: LegalEntityRepository,
      useExisting: DatabaseLegalEntityRepository,
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
