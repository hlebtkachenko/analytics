import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { service: 'application-api'; status: 'ok' } {
    return {
      service: 'application-api',
      status: 'ok',
    };
  }
}
