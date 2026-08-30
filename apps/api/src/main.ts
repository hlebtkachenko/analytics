import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';
import {
  createStagingDirectory,
  loadStagingDirectory,
} from './ingestion/staging.js';
import { ApplicationLogger } from './logger.js';
import { loadRuntimeConfiguration } from './runtime-configuration.js';

async function bootstrap(): Promise<void> {
  const configuration = loadRuntimeConfiguration(process.env);
  await createStagingDirectory(loadStagingDirectory(process.env));
  const logger = new ApplicationLogger();
  const application = await NestFactory.create<NestExpressApplication>(
    AppModule,
    { logger },
  );

  configureApplication(application, logger);
  application.enableShutdownHooks();
  await application.listen(configuration.port, configuration.host);
}

await bootstrap();
