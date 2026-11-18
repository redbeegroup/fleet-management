/**
 * SAP S/4HANA client. The OData / SOAP mapping lives only here so it can be adjusted once the
 * customer's sandbox is available. Standard APIs used (activate them in a communication arrangement):
 *  - API_COSTCENTER_SRV (cost centres)          - API_BUSINESS_PARTNER (suppliers, customers)
 *  - API_PRODUCT_SRV (materials)                - API_FIXEDASSET_SRV (fixed assets)
 *  - Journal Entry - Post (SOAP, JournalEntryBulkCreateRequest)
 *  - API_PURCHASEORDER_PROCESS_SRV (purchase orders)
 *  - API_BILLING_DOCUMENT_SRV (billing documents)
 */
import { createHash } from 'node:crypto';
import type { JournalItem } from './posting';

export interface SapCostCenter { costCenter: string; name: string }
export interface SapVendor { supplier: string; name: string; taxNumber: string | null }
export interface SapMaterial { material: string; description: string; unit: string | null }
export interface SapAsset { assetNo: string; description: string; serial: string | null; inventoryNo: string | null; acquisitionValue: number | null }
export interface SapCustomer { customer: string; name: string }
export interface SapPoItem { item: string; material: string | null; quantity: number; netPrice: number; text: string | null }
export interface SapPo { po: string; supplier: string; items: SapPoItem[]; netValue: number }
export interface SapBillingItem { billingDoc: string; item: string; date: string; soldTo: string; reference: string | null; netAmount: number; currency: string; cancelled: boolean }

export interface JournalDoc {
  companyCode: string;
  currency: string;
  documentDate: string;
  postingDate: string;
  reference: string;
  headerText: string;
  items: JournalItem[];
}
export interface PoRequest {
  companyCode: string;
  purchasingOrg: string;
  purchasingGroup: string;
  plant: string;
  supplier: string;
  currency: string;
  text: string;
  netAmount: number;
  glAccount: string;
  costCenter: string;
  materialGroup: string;
}

export interface SapClient {
  ping(): Promise<{ ok: true; detail: string }>;
  costCenters(controllingArea: string): Promise<SapCostCenter[]>;
  vendors(): Promise<SapVendor[]>;
  materials(): Promise<SapMaterial[]>;
  fixedAssets(companyCode: string): Promise<SapAsset[]>;
  customers(): Promise<SapCustomer[]>;
  postJournal(doc: JournalDoc): Promise<string>;
  createPurchaseOrder(po: PoRequest): Promise<string>;
  getPurchaseOrder(po: string): Promise<SapPo | null>;
  billingDocuments(since: Date | null): Promise<SapBillingItem[]>;
}

export interface SapConnection {
  baseUrl: string;
  authType: 'BASIC' | 'OAUTH';
  username: string;
  secret: string;
  tokenUrl: string | null;
  sapClient: string | null;
}

export class SapError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** OData V2 "/Date(1700000000000+0000)/" or ISO → YYYY-MM-DD. */
export function odataDate(v: unknown): string {
  const s = String(v ?? '');
  const m = /\/Date\((-?\d+)/.exec(s);
  return (m ? new Date(Number(m[1])) : new Date(s)).toISOString().slice(0, 10);
}
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class ODataSapClient implements SapClient {
  private csrf: { token: string; cookie: string } | null = null;
  private bearer: { token: string; until: number } | null = null;

  constructor(
    private readonly c: SapConnection,
    private readonly timeoutMs = 30_000,
  ) {}

  private url(path: string) {
    const u = new URL(this.c.baseUrl.replace(/\/$/, '') + path);
    if (this.c.sapClient) u.searchParams.set('sap-client', this.c.sapClient);
    return u.toString();
  }

  private async auth(): Promise<string> {
    if (this.c.authType === 'BASIC') return `Basic ${Buffer.from(`${this.c.username}:${this.c.secret}`).toString('base64')}`;
    if (this.bearer && this.bearer.until > Date.now() + 30_000) return `Bearer ${this.bearer.token}`;
    if (!this.c.tokenUrl) throw new SapError('OAuth needs a token URL');
    const res = await fetch(this.c.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${this.c.username}:${this.c.secret}`).toString('base64')}` },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new SapError(`Token request failed (HTTP ${res.status})`, res.status);
    const b = (await res.json()) as { access_token: string; expires_in?: number };
    this.bearer = { token: b.access_token, until: Date.now() + (b.expires_in ?? 600) * 1000 };
    return `Bearer ${b.access_token}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: { authorization: await this.auth(), accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new SapError(`GET ${path.split('?')[0]} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
    return (await res.json()) as T;
  }

  /** All pages of an OData V2 collection (follows __next). */
  private async list<T>(path: string, max = 20_000): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path + (path.includes('?') ? '&' : '?') + '$format=json&$top=1000';
    for (let skip = 1000; next && out.length < max; skip += 1000) {
      const b: { d: { results: T[]; __next?: string } } = await this.get(next);
      out.push(...b.d.results);
      next = b.d.results.length === 1000 ? path + (path.includes('?') ? '&' : '?') + `$format=json&$top=1000&$skip=${skip}` : null;
    }
    return out;
  }

  private async token() {
    if (this.csrf) return this.csrf;
    const res = await fetch(this.url('/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/'), { headers: { authorization: await this.auth(), 'x-csrf-token': 'fetch' }, signal: AbortSignal.timeout(this.timeoutMs) });
    const token = res.headers.get('x-csrf-token');
    if (!token) throw new SapError(`No CSRF token (HTTP ${res.status})`, res.status);
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    this.csrf = { token, cookie };
    return this.csrf;
  }

  async ping() {
    await this.get('/sap/opu/odata/sap/API_COSTCENTER_SRV/A_CostCenter?$top=1&$format=json');
    return { ok: true as const, detail: 'Connected (API_COSTCENTER_SRV answered)' };
  }

  async costCenters(area: string) {
    type R = { CostCenter: string; ControllingArea: string; to_Text?: { results: { CostCenterName?: string; CostCenterDescription?: string }[] } };
    const rows = await this.list<R>(`/sap/opu/odata/sap/API_COSTCENTER_SRV/A_CostCenter?$expand=to_Text${area ? `&$filter=ControllingArea eq '${encodeURIComponent(area)}'` : ''}`);
    const seen = new Map<string, SapCostCenter>();
    for (const r of rows) seen.set(r.CostCenter, { costCenter: r.CostCenter, name: r.to_Text?.results?.[0]?.CostCenterName ?? r.to_Text?.results?.[0]?.CostCenterDescription ?? r.CostCenter });
    return [...seen.values()];
  }

  async vendors() {
    type R = { Supplier: string; SupplierName: string; TaxNumber1?: string };
    return (await this.list<R>('/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier?$select=Supplier,SupplierName,TaxNumber1')).map((r) => ({ supplier: r.Supplier, name: r.SupplierName, taxNumber: r.TaxNumber1 || null }));
  }

  async materials() {
    type R = { Product: string; BaseUnit?: string; to_Description?: { results: { Language: string; ProductDescription: string }[] } };
    return (await this.list<R>('/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$expand=to_Description')).map((r) => ({
      material: r.Product,
      description: r.to_Description?.results?.find((d) => d.Language === 'EN')?.ProductDescription ?? r.to_Description?.results?.[0]?.ProductDescription ?? r.Product,
      unit: r.BaseUnit ?? null,
    }));
  }

  async fixedAssets(companyCode: string) {
    type R = { MasterFixedAsset: string; FixedAsset: string; FixedAssetDescription?: string; AssetSerialNumber?: string; InventoryNumber?: string; AcquisitionValue?: string };
    return (await this.list<R>(`/sap/opu/odata/sap/API_FIXEDASSET_SRV/A_FixedAsset?$filter=CompanyCode eq '${encodeURIComponent(companyCode)}'`))
      .filter((r) => !r.FixedAsset || r.FixedAsset === '0')
      .map((r) => ({ assetNo: r.MasterFixedAsset, description: r.FixedAssetDescription ?? '', serial: r.AssetSerialNumber || null, inventoryNo: r.InventoryNumber || null, acquisitionValue: r.AcquisitionValue ? num(r.AcquisitionValue) : null }));
  }

  async customers() {
    type R = { Customer: string; CustomerName: string };
    return (await this.list<R>('/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Customer?$select=Customer,CustomerName')).map((r) => ({ customer: r.Customer, name: r.CustomerName }));
  }

  /** Journal Entry - Post (SOAP). Returns the accounting document number. */
  async postJournal(d: JournalDoc) {
    const items = d.items
      .map(
        (i, k) => `<Item><ReferenceDocumentItem>${k + 1}</ReferenceDocumentItem><GLAccount>${xml(i.glAccount)}</GLAccount>` +
          `<AmountInTransactionCurrency currencyCode="${xml(d.currency)}">${i.side === 'S' ? '' : '-'}${i.amount.toFixed(2)}</AmountInTransactionCurrency>` +
          `<DebitCreditCode>${i.side}</DebitCreditCode><DocumentItemText>${xml(i.text.slice(0, 50))}</DocumentItemText>` +
          (i.costCenter ? `<AccountAssignment><CostCenter>${xml(i.costCenter)}</CostCenter></AccountAssignment>` : '') +
          `</Item>`,
      )
      .join('');
    const body =
      `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sfin="http://sap.com/xi/SAPSCORE/SFIN"><soapenv:Body>` +
      `<sfin:JournalEntryBulkCreateRequest><MessageHeader><CreationDateTime>${new Date().toISOString()}</CreationDateTime></MessageHeader>` +
      `<JournalEntryCreateRequest><MessageHeader><CreationDateTime>${new Date().toISOString()}</CreationDateTime></MessageHeader><JournalEntry>` +
      `<OriginalReferenceDocumentType>BKPFF</OriginalReferenceDocumentType><OriginalReferenceDocument>${xml(d.reference)}</OriginalReferenceDocument>` +
      `<OriginalReferenceDocumentLogicalSystem>FMS</OriginalReferenceDocumentLogicalSystem><BusinessTransactionType>RFBU</BusinessTransactionType>` +
      `<AccountingDocumentType>SA</AccountingDocumentType><DocumentReferenceID>${xml(d.reference)}</DocumentReferenceID><DocumentHeaderText>${xml(d.headerText.slice(0, 25))}</DocumentHeaderText>` +
      `<CreatedByUser>${xml(this.c.username.slice(0, 12))}</CreatedByUser><CompanyCode>${xml(d.companyCode)}</CompanyCode>` +
      `<DocumentDate>${d.documentDate}</DocumentDate><PostingDate>${d.postingDate}</PostingDate>${items}` +
      `</JournalEntry></JournalEntryCreateRequest></sfin:JournalEntryBulkCreateRequest></soapenv:Body></soapenv:Envelope>`;
    const res = await fetch(this.url('/sap/bc/srt/scs_ext/sap/journalentrycreaterequestconfi'), {
      method: 'POST',
      headers: { authorization: await this.auth(), 'content-type': 'text/xml; charset=utf-8', soapaction: 'http://sap.com/xi/SAPSCORE/SFIN/JournalEntryCreateRequestConfirmation_In/JournalEntryCreateRequestConfirmation_InRequest' },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new SapError(`Journal post failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
    const doc = /<AccountingDocument>(\d+)<\/AccountingDocument>/.exec(text)?.[1];
    if (!doc || /^0+$/.test(doc)) {
      const notes = [...text.matchAll(/<Note>([^<]+)<\/Note>/g)].map((m) => m[1]).join('; ');
      throw new SapError(`SAP did not post the journal entry${notes ? `: ${notes}` : ''}`);
    }
    return doc;
  }

  async createPurchaseOrder(p: PoRequest) {
    const { token, cookie } = await this.token();
    const res = await fetch(this.url('/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder'), {
      method: 'POST',
      headers: { authorization: await this.auth(), 'x-csrf-token': token, ...(cookie && { cookie }), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        PurchaseOrderType: 'NB',
        CompanyCode: p.companyCode,
        PurchasingOrganization: p.purchasingOrg,
        PurchasingGroup: p.purchasingGroup,
        Supplier: p.supplier,
        DocumentCurrency: p.currency,
        to_PurchaseOrderItem: [
          {
            PurchaseOrderItem: '10',
            PurchaseOrderItemText: p.text.slice(0, 40),
            Plant: p.plant,
            MaterialGroup: p.materialGroup,
            OrderQuantity: '1',
            PurchaseOrderQuantityUnit: 'EA',
            NetPriceAmount: p.netAmount.toFixed(2),
            AccountAssignmentCategory: 'K',
            to_AccountAssignment: [{ AccountAssignmentNumber: '1', GLAccount: p.glAccount, CostCenter: p.costCenter }],
          },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (res.status === 403) this.csrf = null;
    if (!res.ok) throw new SapError(`Purchase order failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
    const po = (JSON.parse(text) as { d?: { PurchaseOrder?: string } }).d?.PurchaseOrder;
    if (!po) throw new SapError('SAP returned no purchase order number');
    return po;
  }

  async getPurchaseOrder(po: string) {
    type I = { PurchaseOrderItem: string; Material?: string; OrderQuantity: string; NetPriceAmount: string; PurchaseOrderItemText?: string };
    try {
      const b = await this.get<{ d: { PurchaseOrder: string; Supplier: string; to_PurchaseOrderItem: { results: I[] } } }>(`/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${encodeURIComponent(po)}')?$expand=to_PurchaseOrderItem&$format=json`);
      const items = b.d.to_PurchaseOrderItem.results.map((i) => ({ item: i.PurchaseOrderItem, material: i.Material || null, quantity: num(i.OrderQuantity), netPrice: num(i.NetPriceAmount), text: i.PurchaseOrderItemText ?? null }));
      return { po: b.d.PurchaseOrder, supplier: b.d.Supplier, items, netValue: Math.round(items.reduce((a, i) => a + i.quantity * i.netPrice, 0) * 100) / 100 };
    } catch (e) {
      if (e instanceof SapError && e.status === 404) return null;
      throw e;
    }
  }

  async billingDocuments(since: Date | null) {
    type I = { BillingDocumentItem: string; NetAmount: string; ReferenceSDDocument?: string };
    type H = { BillingDocument: string; BillingDocumentDate: string; SoldToParty: string; TransactionCurrency: string; BillingDocumentIsCancelled?: boolean; PurchaseOrderByCustomer?: string; to_Item: { results: I[] } };
    const filter = since ? `&$filter=LastChangeDateTime ge datetimeoffset'${since.toISOString().replace(/\.\d{3}Z$/, 'Z')}'` : '';
    const docs = await this.list<H>(`/sap/opu/odata/sap/API_BILLING_DOCUMENT_SRV/A_BillingDocument?$expand=to_Item${filter}`);
    return docs.flatMap((d) =>
      d.to_Item.results.map((i) => ({
        billingDoc: d.BillingDocument,
        item: i.BillingDocumentItem,
        date: odataDate(d.BillingDocumentDate),
        soldTo: d.SoldToParty,
        reference: d.PurchaseOrderByCustomer || i.ReferenceSDDocument || null,
        netAmount: num(i.NetAmount),
        currency: d.TransactionCurrency,
        cancelled: !!d.BillingDocumentIsCancelled,
      })),
    );
  }
}

/** Deterministic stand-in for demos and tests until a sandbox exists (SAP_MODE=mock). */
export class MockSapClient implements SapClient {
  constructor(private readonly hooks: { purchaseOrder(po: string): Promise<SapPo | null>; billing(since: Date | null): Promise<SapBillingItem[]> }) {}

  private no(prefix: string, seed: string, len = 8) {
    return prefix + String(parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 10), 16) % 10 ** len).padStart(len, '0');
  }
  async ping() {
    return { ok: true as const, detail: 'Mock SAP (no real system)' };
  }
  async costCenters() {
    return [
      { costCenter: 'FL1000', name: 'Fleet Yangon' },
      { costCenter: 'FL2000', name: 'Fleet Mandalay' },
      { costCenter: 'FL9000', name: 'Fleet administration' },
    ];
  }
  async vendors() {
    return [
      { supplier: '100001', name: 'Shwe Auto Garage', taxNumber: null },
      { supplier: '100002', name: 'Yangon Truck Parts', taxNumber: null },
      { supplier: '100003', name: 'Golden Tyre Co.', taxNumber: null },
    ];
  }
  async materials() {
    return ['ALT-24V-80A', 'OF-ISZ-01', 'BP-FR-02', 'BAT-12V-100'].map((m) => ({ material: m, description: m, unit: 'EA' }));
  }
  async fixedAssets() {
    return [
      { assetNo: '200001', description: 'Truck Isuzu FVR YGN-1A-1001', serial: null, inventoryNo: 'YGN-1A-1001', acquisitionValue: 95_000_000 },
      { assetNo: '200002', description: 'Truck Hino 500 MDY-4D-4004', serial: null, inventoryNo: 'MDY-4D-4004', acquisitionValue: 110_000_000 },
    ];
  }
  async customers() {
    return [];
  }
  async postJournal(d: JournalDoc) {
    return this.no('10', `${d.reference}:${d.postingDate}:${d.items.length}:${Date.now()}`);
  }
  async createPurchaseOrder(p: PoRequest) {
    return this.no('45', `${p.supplier}:${p.text}:${p.netAmount}:${Date.now()}`);
  }
  getPurchaseOrder(po: string) {
    return this.hooks.purchaseOrder(po);
  }
  billingDocuments(since: Date | null) {
    return this.hooks.billing(since);
  }
}
