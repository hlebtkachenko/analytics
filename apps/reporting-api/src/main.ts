import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { loadRuntimeConfiguration } from './runtime-configuration.js';

async function bootstrap(): Promise<void> {
  const configuration = loadRuntimeConfiguration(process.env);
  const application = await NestFactory.create(AppModule);

  application.enableShutdownHooks();
  await application.listen(configuration.port, configuration.host);
}

await bootstrap();
