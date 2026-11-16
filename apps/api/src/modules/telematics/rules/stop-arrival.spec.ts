import { stopArrival } from './stop-arrival';

const stops = [
  { id: 'a', latitude: 16.8, longitude: 96.1, open: true },
  { id: 'b', latitude: 16.8, longitude: 96.101, open: true }, // ~107 m east of a
  { id: 'c', latitude: 16.9, longitude: 96.1, open: false },
];
const fix = (lat: number, lng: number, speed = 0) => ({ recordedAt: new Date(), latitude: lat, longitude: lng, speedKmh: speed });

describe('stop arrival', () => {
  it('arrives at the nearest open stop when (almost) stopped inside the radius', () => {
    expect(stopArrival(null, stops, fix(16.8, 96.1003), 150)).toEqual({ enter: 'a', exit: false });
    expect(stopArrival(null, stops, fix(16.8, 96.1008), 150)).toEqual({ enter: 'b', exit: false });
    expect(stopArrival(null, stops, fix(16.8, 96.1003, 40), 150)).toEqual({ enter: null, exit: false }); // driving past
    expect(stopArrival(null, stops, fix(16.9, 96.1), 150)).toEqual({ enter: null, exit: false }); // completed stop
    expect(stopArrival(null, stops, fix(16.81, 96.1), 150)).toEqual({ enter: null, exit: false }); // 1.1 km away
  });
  it('leaves only beyond twice the radius, and can arrive at the next stop at once', () => {
    expect(stopArrival('a', stops, fix(16.8, 96.1025, 20), 150)).toEqual({ enter: null, exit: false }); // 267 m < 300
    expect(stopArrival('a', stops, fix(16.8, 96.104, 30), 150)).toEqual({ enter: null, exit: true });
    expect(stopArrival('a', [{ ...stops[0] }, { id: 'd', latitude: 16.8, longitude: 96.11, open: true }], fix(16.8, 96.11), 150)).toEqual({ enter: 'd', exit: true });
    expect(stopArrival('gone', stops, fix(16.8, 96.1), 150)).toEqual({ enter: 'a', exit: true });
  });
});
