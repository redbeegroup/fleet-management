import type { PodSettings } from '@fms/shared';
import { haversineM } from '../telematics/rules/geo';

export interface PodInput {
  outcome: 'DELIVERED' | 'PARTIAL' | 'FAILED';
  photoFileIds: string[];
  signature?: { name: string; strokes: [number, number][][] } | null;
  latitude?: number | null;
  longitude?: number | null;
  codCollected?: number | null;
}

export interface PodResult {
  errors: string[];
  flags: string[];
  distanceM: number | null;
}

/**
 * Proof-of-delivery rules. Missing required evidence is an error (400); suspicious but
 * possible situations (far from the customer, no GPS, cash mismatch) are flags for review.
 */
export function evaluatePod(p: PodInput, ctx: { stopLat: number | null; stopLng: number | null; codExpected: number; settings: PodSettings }): PodResult {
  const errors: string[] = [];
  const flags: string[] = [];
  const handedOver = p.outcome !== 'FAILED';
  if (handedOver && ctx.settings.requirePhoto && p.photoFileIds.length === 0) errors.push('Take at least one photo of the delivery');
  if (handedOver && ctx.settings.requireSignature && !p.signature) errors.push("Get the recipient's signature");
  if (handedOver && ctx.settings.requireCodEntry && ctx.codExpected > 0 && p.codCollected == null) errors.push('Enter the cash collected');

  let distanceM: number | null = null;
  if (p.latitude == null || p.longitude == null) flags.push('NO_GPS');
  else if (ctx.stopLat != null && ctx.stopLng != null) {
    distanceM = Math.round(haversineM(p.latitude, p.longitude, ctx.stopLat, ctx.stopLng));
    if (distanceM > ctx.settings.maxDistanceM) flags.push('FAR_FROM_CUSTOMER');
  }
  if (handedOver && p.codCollected != null && ctx.codExpected > 0) {
    if (p.codCollected < ctx.codExpected - 0.5) flags.push('COD_SHORT');
    if (p.codCollected > ctx.codExpected + 0.5) flags.push('COD_OVER');
  }
  if (!handedOver && p.codCollected != null && p.codCollected > 0) flags.push('COD_OVER');
  return { errors, flags, distanceM };
}
