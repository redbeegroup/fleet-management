import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { env } from '../../common/config/env';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageDriver, S3StorageDriver, STORAGE_DRIVER } from './storage';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_DRIVER,
      useFactory: () => {
        const cfg = env();
        if (cfg.STORAGE_DRIVER === 's3') {
          if (!cfg.S3_ACCESS_KEY || !cfg.S3_SECRET_KEY) throw new Error('S3_ACCESS_KEY and S3_SECRET_KEY are required');
          const client = new S3Client({
            endpoint: cfg.S3_ENDPOINT,
            region: cfg.S3_REGION,
            forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
          });
          return new S3StorageDriver(client, cfg.S3_BUCKET);
        }
        return new LocalStorageDriver(cfg.STORAGE_LOCAL_DIR);
      },
    },
  ],
  exports: [FilesService],
})
export class FilesModule {}
