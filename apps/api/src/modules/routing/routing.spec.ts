import { resetEnvCache } from '../../common/config/env';
import { decodePolyline, encodePolyline } from './polyline';
import { OsrmVroomProvider, StraightLineProvider } from './providers';
import { RoutingService } from './routing.service';

// Recorded responses (trimmed) from osrm-backend 5.27 and vroom-express 1.14.
const OSRM_ROUTE = {
  code: 'Ok',
  routes: [{ distance: 18234.5, duration: 1562.3, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', legs: [{ distance: 9100, duration: 760 }, { distance: 9134.5, duration: 802.3 }] }],
};
const VROOM_SOLUTION = {
  code: 0,
  routes: [
    {
      vehicle: 1,
      distance: 24510,
      duration: 2400,
      geometry: 'abc',
      steps: [
        { type: 'start', arrival: 1763253000 },
        { type: 'job', id: 2, arrival: 1763253600 },
        { type: 'job', id: 1, arrival: 1763255400 },
        { type: 'end', arrival: 1763257000 },
      ],
    },
  ],
  unassigned: [{ id: 3 }],
};

const depot = { lat: 16.87, lng: 96.06 };
const start = new Date(1763253000 * 1000);

describe('polyline', () => {
  it('round-trips points', () => {
    const pts = [
      { lat: 16.87, lng: 96.06 },
      { lat: 16.8253, lng: 96.1297 },
      { lat: 16.79, lng: 96.2 },
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }])).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
});

describe('OSRM / VROOM adapter', () => {
  const realFetch = global.fetch;
  let calls: { url: string; body?: unknown }[] = [];
  const mock = (reply: unknown, status = 200) => {
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply), { status });
    }) as typeof fetch;
  };
  beforeEach(() => (calls = []));
  afterAll(() => (global.fetch = realFetch));

  it('maps an OSRM route', async () => {
    mock(OSRM_ROUTE);
    const r = await new OsrmVroomProvider('http://osrm:5000/', null).route([depot, { lat: 16.8, lng: 96.13 }, depot]);
    expect(calls[0].url).toBe('http://osrm:5000/route/v1/driving/96.060000,16.870000;96.130000,16.800000;96.060000,16.870000?overview=full&geometries=polyline&steps=false');
    expect(r).toEqual({ km: 18.2, minutes: 26, geometry: OSRM_ROUTE.routes[0].geometry, legs: [{ km: 9.1, minutes: 13 }, { km: 9.1, minutes: 13 }] });
  });

  it('builds the VROOM problem with integer capacities and windows', () => {
    const { body } = OsrmVroomProvider.problem(
      depot,
      [{ id: 'veh', capacity: [1500, 9, null, 4], maxTasks: 10, start }],
      [{ id: 'job', location: { lat: 16.8, lng: 96.13 }, serviceMinutes: 15, window: { start, end: new Date(start.getTime() + 3600_000) }, amount: [250.4, 0.45, 20, 0.5], priority: 100 }],
    );
    expect(body.vehicles[0]).toMatchObject({ id: 1, start: [96.06, 16.87], end: [96.06, 16.87], capacity: [1500, 9000, 1_000_000_000, 40], max_tasks: 10 });
    expect(body.jobs[0]).toMatchObject({ id: 1, location: [96.13, 16.8], service: 900, delivery: [251, 450, 20, 5], priority: 100, time_windows: [[1763253000, 1763256600]] });
  });

  it('maps a VROOM solution back to our ids', async () => {
    mock(VROOM_SOLUTION);
    const r = await new OsrmVroomProvider('http://osrm:5000', 'http://vroom:3000').optimize(
      depot,
      [{ id: 'veh-A', capacity: [null, null, null, null], maxTasks: null, start }],
      ['j1', 'j2', 'j3'].map((id) => ({ id, location: { lat: 16.8, lng: 96.1 }, serviceMinutes: 10, window: null, amount: [0, 0, 0, 0] as [number, number, number, number], priority: 0 })),
    );
    expect(r).toEqual({
      routes: [{ vehicleId: 'veh-A', jobIds: ['j2', 'j1'], arrivals: [new Date(1763253600 * 1000), new Date(1763255400 * 1000)], km: 24.5, minutes: 40, geometry: 'abc' }],
      unassigned: ['j3'],
    });
    mock({ code: 2, error: 'Invalid input' });
    await expect(new OsrmVroomProvider('http://osrm:5000', 'http://vroom:3000').optimize(depot, [], [])).rejects.toThrow('VROOM 2: Invalid input');
  });
});

describe('RoutingService fallback', () => {
  const realFetch = global.fetch;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://unit@localhost/unit';
    process.env.JWT_ACCESS_SECRET ??= 'unit-test-secret-unit-test-secret-0000';
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.OSRM_URL;
    delete process.env.VROOM_URL;
    resetEnvCache();
  });

  it('uses straight lines when routing is not configured', async () => {
    resetEnvCache();
    const r = await new RoutingService().sequence(
      depot,
      [
        { id: 'far', lat: 16.95, lng: 96.06, serviceMinutes: 10, window: null, amount: [0, 0, 0, 0] },
        { id: 'near', lat: 16.88, lng: 96.06, serviceMinutes: 10, window: null, amount: [0, 0, 0, 0] },
      ],
      start,
      30,
    );
    expect(r).toMatchObject({ order: ['near', 'far'], source: 'straight-line' });
    expect(r.arrivals.get('near')!.getTime()).toBe(start.getTime() + 2 * 60_000); // 1.1 km at 30 km/h
    expect(r.km).toBeCloseTo(17.8, 0);
  });

  it('falls back when OSRM/VROOM are down', async () => {
    process.env.OSRM_URL = 'http://127.0.0.1:9';
    process.env.VROOM_URL = 'http://127.0.0.1:9';
    resetEnvCache();
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const r = await new RoutingService().sequence(depot, [{ id: 'a', lat: 16.88, lng: 96.06, serviceMinutes: 5, window: null, amount: [0, 0, 0, 0] }], start, 30);
    expect(r.source).toBe('straight-line');
    expect(new StraightLineProvider(30).route([depot, depot]).km).toBe(0);
  });
});
