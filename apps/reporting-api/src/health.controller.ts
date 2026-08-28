import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { service: 'reporting-api'; status: 'ok' } {
    return {
      service: 'reporting-api',
      status: 'ok',
    };
  }
}
