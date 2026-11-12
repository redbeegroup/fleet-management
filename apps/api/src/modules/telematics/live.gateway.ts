import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, permissionsForRoles } from '@fms/shared';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';

/**
 * Live map push. Clients connect to path /api/socket.io with `auth: { token }`
 * and join their company room. Ingest processes publish to Redis; every API pod
 * subscribes and forwards to its own sockets, so this scales horizontally.
 */
@WebSocketGateway({ path: '/api/socket.io', cors: { origin: true, credentials: true } })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(LiveGateway.name);
  private subscriber?: Redis;
  @WebSocketServer() server: Server;

  constructor(private readonly jwt: JwtService) {}

  afterInit(): void {
    this.subscriber = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
    void this.subscriber.psubscribe('fms:live:*', 'fms:events:*');
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const [, kind, companyId] = channel.split(':');
      try {
        this.server.to(`company:${companyId}`).emit(kind === 'live' ? 'positions' : 'events', JSON.parse(message));
      } catch (err) {
        this.logger.warn(`Bad live message on ${channel}: ${(err as Error).message}`);
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? '';
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      if (!permissionsForRoles(payload.roles).includes(Permission.TRACKING_READ)) throw new Error('forbidden');
      await client.join(`company:${payload.cid}`);
      // Access tokens are short-lived: drop the socket when it expires; the client reconnects with a fresh one.
      const exp = (payload as AccessTokenPayload & { exp?: number }).exp;
      if (exp) setTimeout(() => client.disconnect(true), Math.max(0, exp * 1000 - Date.now())).unref();
    } catch {
      client.emit('unauthorized');
      client.disconnect(true);
    }
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
  }
}
