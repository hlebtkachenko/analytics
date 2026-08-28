import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { MembershipResolver } from './membership-resolver.js';

@ApiExcludeController()
@Controller('ready')
export class ReadyController {
  constructor(
    @Inject(MembershipResolver)
    private readonly memberships: MembershipResolver,
  ) {}

  @Get()
  async getReadiness(): Promise<{
    service: 'application-api';
    status: 'ready';
  }> {
    if (!(await this.memberships.checkReadiness())) {
      throw new ServiceUnavailableException();
    }

    return { service: 'application-api', status: 'ready' };
  }
}
