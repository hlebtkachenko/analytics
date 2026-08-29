import { Module } from '@nestjs/common';
import {
  createResourceJwtVerifier,
  SubjectRateLimiter,
  type ResourceJwtVerifier,
} from '@bap/security';
import { loadDatabaseConfiguration } from '@bap/db/config';

import { AccessController } from './access.controller.js';
import { DatabaseMembershipResolver } from './database-membership-resolver.js';
import { HealthController } from './health.controller.js';
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
  ],
  providers: [
    {
      provide: MembershipResolver,
      useFactory: async (): Promise<DatabaseMembershipResolver> =>
        new DatabaseMembershipResolver(
          await loadDatabaseConfiguration(process.env, {
            role: 'bap_reporting',
          }),
        ),
    },
    {
      inject: [MembershipResolver],
      provide: ServiceMetrics,
      useFactory: (memberships: MembershipResolver): ServiceMetrics =>
        new ServiceMetrics(memberships),
    },
    ResourceJwtGuard,
    SubjectRateLimitGuard,
    {
      provide: RESOURCE_JWT_VERIFIER,
      useFactory: (): ResourceJwtVerifier => {
        const configuration = loadRuntimeConfiguration(process.env);
        return createResourceJwtVerifier(configuration);
      },
    },
    {
      provide: SUBJECT_RATE_LIMITER,
      useFactory: (): SubjectRateLimiter => {
        const configuration = loadRuntimeConfiguration(process.env);
        return new SubjectRateLimiter(configuration.rateLimit);
      },
    },
  ],
})
export class AppModule {}
