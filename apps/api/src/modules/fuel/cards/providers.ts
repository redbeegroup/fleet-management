import { Logger } from '@nestjs/common';
import { env } from '../../../common/config/env';

/** A transaction as delivered by a fuel card provider (statement row or API item). */
export interface RawCardTxn {
  externalId: string;
  card: string;
  occurredAt: Date;
  amount: number;
  litres: number | null;
  station: string | null;
  product: string | null;
  plate: string | null;
}

export interface FuelCardProvider {
  readonly name: string;
  /** Transactions for this company's account since the given time. */
  fetchTransactions(account: { companyId: string; companyCode: string }, since: Date): Promise<RawCardTxn[]>;
}

/**
 * Generic REST adapter. The provider is not chosen yet, so the contract is an assumption to be confirmed:
 * GET {FUEL_CARD_API_URL}/transactions?account=<code>&since=<ISO> with "Authorization: Bearer <key>",
 * returning [{ id, cardNumber, dateTime, amount, litres?, station?, product?, plate? }].
 */
export class RestFuelCardProvider implements FuelCardProvider {
  readonly name = 'rest';
  private readonly logger = new Logger(RestFuelCardProvider.name);

  async fetchTransactions(account: { companyCode: string }, since: Date): Promise<RawCardTxn[]> {
    const e = env();
    if (!e.FUEL_CARD_API_URL) throw new Error('FUEL_CARD_API_URL is not set');
    const url = `${e.FUEL_CARD_API_URL.replace(/\/$/, '')}/transactions?account=${encodeURIComponent(account.companyCode)}&since=${since.toISOString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', ...(e.FUEL_CARD_API_KEY && { Authorization: `Bearer ${e.FUEL_CARD_API_KEY}` }) }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Fuel card API ${res.status}`);
    const body = (await res.json()) as unknown;
    const items = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
    return items.flatMap((x) => {
      const r = x as Record<string, unknown>;
      const at = new Date(String(r.dateTime ?? r.occurredAt ?? r.date));
      const amount = Number(r.amount);
      if (!r.id || !r.cardNumber || Number.isNaN(at.getTime()) || !Number.isFinite(amount)) {
        this.logger.warn('Skipping malformed fuel card transaction');
        return [];
      }
      return [{ externalId: String(r.id), card: String(r.cardNumber), occurredAt: at, amount, litres: r.litres == null ? null : Number(r.litres), station: (r.station as string) ?? null, product: (r.product as string) ?? null, plate: (r.plate as string) ?? null }];
    });
  }
}

/**
 * Demo/test provider: one card transaction per recorded fill of a vehicle with a card (same litres; every
 * fifth one 8 % more expensive to show a mismatch), plus one transaction FMS has no record of.
 */
export class MockFuelCardProvider implements FuelCardProvider {
  readonly name = 'mock';
  constructor(private readonly fills: (companyId: string, since: Date) => Promise<{ id: string; card: string; filledAt: Date; litres: number; totalCost: number; plate: string }[]>) {}

  async fetchTransactions(account: { companyId: string }, since: Date): Promise<RawCardTxn[]> {
    const fills = await this.fills(account.companyId, since);
    const out: RawCardTxn[] = fills.map((f, i) => ({
      externalId: `mock-${f.id}`,
      card: f.card,
      occurredAt: new Date(f.filledAt.getTime() + 7 * 60_000),
      amount: Math.round(f.totalCost * (i % 5 === 4 ? 1.08 : 1)),
      litres: f.litres,
      station: 'Demo station',
      product: 'Diesel',
      plate: f.plate,
    }));
    if (fills[0]) out.push({ externalId: `mock-extra-${fills[0].id}`, card: fills[0].card, occurredAt: new Date(fills[0].filledAt.getTime() + 26 * 3_600_000), amount: 95_000, litres: 30, station: 'Unknown station', product: 'Diesel', plate: fills[0].plate });
    return out;
  }
}
