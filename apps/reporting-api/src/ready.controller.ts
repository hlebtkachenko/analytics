import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';

@ApiExcludeController()
@Controller('ready')
export class ReadyController {
  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
    @Inject(ServiceMetrics)
    private readonly metrics: ServiceMetrics,
  ) {}

  @Get()
  async getReadiness(): Promise<{ service: 'reporting-api'; status: 'ready' }> {
    const ready = await this.memberships.checkReadiness();
    this.metrics.setMigrationCompatible(ready);

    if (!ready) {
      throw new ServiceUnavailableException();
    }

    return { service: 'reporting-api', status: 'ready' };
  }
}
