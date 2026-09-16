import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';
import { createBlobDirectories } from './blobs/blob-store.js';
import {
  createStagingDirectory,
  loadStagingDirectory,
} from './ingestion/staging.js';
import { ApplicationLogger } from './logger.js';
import { loadRuntimeConfiguration } from './runtime-configuration.js';

async function bootstrap(): Promise<void> {
  // Blob directories are 0770 and files 0660 so the backup one-shot can read them through the group.
  process.umask(0o007);
  const configuration = loadRuntimeConfiguration(process.env);
  await createStagingDirectory(loadStagingDirectory(process.env));
  await createBlobDirectories(configuration.blob.storageDirectory);
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
