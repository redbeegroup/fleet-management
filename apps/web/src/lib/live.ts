import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { accessToken, refresh } from './api';

export interface LiveHandlers {
  onPositions?: (p: LiveUpdate[]) => void;
  onEvents?: (e: LiveEvent[]) => void;
}

export interface LiveUpdate {
  vehicleId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  ignition: boolean | null;
}

export interface LiveEvent {
  id: string;
  type: string;
  vehicleId: string;
  plateNumber: string;
  occurredAt: string;
  speedKmh: number | null;
  data: Record<string, unknown> | null;
}

/**
 * Subscribes to live positions/events. The access token is read on every
 * (re)connect; when the server drops us because it expired, refresh and retry.
 */
export function useLive(handlers: LiveHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const socket: Socket = io({
      path: '/api/socket.io',
      transports: ['websocket'],
      auth: (cb) => cb({ token: accessToken() }),
      reconnectionDelayMax: 10_000,
    });
    socket.on('positions', (p: LiveUpdate[]) => ref.current.onPositions?.(p));
    socket.on('events', (e: LiveEvent[]) => ref.current.onEvents?.(e));
    socket.on('unauthorized', () => void refresh());
    socket.on('disconnect', (reason) => {
      // Server-initiated disconnects (token expiry) are not retried automatically.
      if (reason === 'io server disconnect') void refresh().then(() => socket.connect());
    });
    return () => {
      socket.disconnect();
    };
  }, []);
}
