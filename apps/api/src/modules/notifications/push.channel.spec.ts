import { ExpoPushChannel } from './push.channel';

describe('ExpoPushChannel', () => {
  const devices = [
    { id: 'd1', pushToken: 'ExponentPushToken[aaa]' },
    { id: 'd2', pushToken: 'ExponentPushToken[bbb]' },
  ];
  const deleteMany = jest.fn();
  const db = {
    system: (fn: (tx: unknown) => unknown) => fn({ userDevice: { findMany: async () => devices, deleteMany } }),
  } as never;
  const n = { companyId: 'c', topic: 'trip.assigned', title: 'New trip', body: 'A → B', severity: 'info' as const, userIds: ['u'] };

  it('accepts warnings and user-addressed notifications only', () => {
    const ch = new ExpoPushChannel(db, 'https://push');
    expect(ch.accepts({ ...n, userIds: undefined })).toBe(false);
    expect(ch.accepts(n)).toBe(true);
    expect(ch.accepts({ ...n, userIds: undefined, severity: 'warning' })).toBe(true);
  });

  it('sends one message per device and prunes unregistered tokens', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    });
    const ch = new ExpoPushChannel(db, 'https://push', 'tok', fetchImpl as unknown as typeof fetch);
    await ch.send({ id: 'u', email: 'e', fullName: 'f' }, n);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://push');
    expect(JSON.parse(init.body).map((m: { to: string }) => m.to)).toEqual(devices.map((d) => d.pushToken));
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['d2'] } } });
  });
});
