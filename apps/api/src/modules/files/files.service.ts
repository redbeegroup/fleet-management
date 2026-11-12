import { BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ALLOWED_UPLOAD_TYPES } from '@fms/shared';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from './storage';

export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Magic-number sniffing so a renamed executable cannot be stored as "image/png". */
export function sniffContentType(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1)/.test(buf.subarray(8, 12).toString('latin1')))
    return 'image/heic';
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

@Injectable()
export class FilesService {
  constructor(
    private readonly db: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async upload(user: AuthUser, file: UploadedFileInput | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('A non-empty "file" field is required');
    if (file.size > env().FILE_MAX_MB * 1024 * 1024) throw new PayloadTooLargeException();
    const contentType = sniffContentType(file.buffer);
    if (!contentType || !(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(contentType)) {
      throw new BadRequestException(`Unsupported file type. Allowed: ${ALLOWED_UPLOAD_TYPES.join(', ')}`);
    }
    const id = randomUUID();
    const now = new Date();
    const storageKey = `${user.companyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    try {
      return await this.db.tenant(user.companyId, (tx) =>
        tx.storedFile.create({
          data: {
            id,
            companyId: user.companyId,
            storageKey,
            filename: safeFilename(file.originalname),
            contentType,
            sizeBytes: file.size,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedBy: user.userId,
          },
          select: { id: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
        }),
      );
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  async open(user: AuthUser, id: string): Promise<{ stream: Readable; filename: string; contentType: string; size: number }> {
    const file = await this.db.tenant(user.companyId, (tx) => tx.storedFile.findFirst({ where: { id } }));
    if (!file) throw new NotFoundException('File not found');
    return { stream: await this.storage.get(file.storageKey), filename: file.filename, contentType: file.contentType, size: file.sizeBytes };
  }

  /**
   * Foreign keys are checked without RLS, so a caller could reference another
   * company's file id. Every attach goes through this check inside the tenant tx.
   */
  static async assertOwned(tx: Tx, fileId: string | null | undefined): Promise<void> {
    if (!fileId) return;
    const found = await tx.storedFile.findFirst({ where: { id: fileId }, select: { id: true } });
    if (!found) throw new BadRequestException('fileId does not exist');
  }
}
