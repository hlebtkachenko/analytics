import { Module } from '@nestjs/common';
import { createResourceJwtVerifier, SubjectRateLimiter } from '@bap/security';

import { AccessController } from './access.controller.js';
import { DatabaseMembershipResolver } from './database-membership-resolver.js';
import { HealthController } from './health.controller.js';
import {
  IngestionQueue,
  PgBossIngestionQueue,
} from './ingestion/ingestion-queue.js';
import { UploadController } from './ingestion/upload.controller.js';
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
    HealthController,
    MetricsController,
    ReadyController,
    UploadController,
  ],
  providers: [
    DatabaseMembershipResolver,
    DatabaseUploadRepository,
    PgBossIngestionQueue,
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
