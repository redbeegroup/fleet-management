# FMS Integration API v1 (for the DMS and other systems)

Base URL: `https://<fms-host>/api/integrations/v1`. The machine-readable contract (OpenAPI) is at `https://<fms-host>/api/integrations/docs`.

## 1. Authentication

A company admin creates an API key in **Integrations → API keys**. The key is shown **once**; store it in the calling system's secret store.

```
X-API-Key: fms_<prefix>_<secret>
```

- Keys work **only** on `/api/integrations/v1/*`. They are never accepted on the console API, and console logins are never accepted here.
- Every key has scopes:

  | Scope | Allows |
  |---|---|
  | `orders:write` | create, update and cancel orders |
  | `orders:read` | read orders and the changes feed |
  | `trips:read` | read trips |
  | `vehicles:read` | read the vehicle list |
  | `tracking:read` | read latest vehicle positions |

- A key can expire and can be revoked at any time.
- Missing, invalid, revoked or expired key → `401`. Missing scope → `403`.
- Rate limit: 300 requests per minute per key (`429` when exceeded; retry after a short pause).

## 2. Delivery orders

An order is identified by **your** order number (`externalRef`: letters, digits and `. _ - /`, max 64), so you never need FMS ids.

### Create or replace — `PUT /orders/{externalRef}`

```json
{
  "customer": {
    "code": "YGN-0012",
    "name": "Shwe Mart Hledan",
    "phone": "+95 9 123 456",
    "address": "No. 5, Pyay Road",
    "township": "Kamayut",
    "city": "Yangon",
    "latitude": 16.8231,
    "longitude": 96.1302
  },
  "depotCode": "YGN",
  "deliveryDate": "2026-11-16",
  "orderDate": "2026-11-15T09:00:00+06:30",
  "priority": "NORMAL",
  "deliveryWindow": { "start": "2026-11-16T09:00:00+06:30", "end": "2026-11-16T12:00:00+06:30" },
  "address": null,
  "contactName": "Daw Hla",
  "contactPhone": "+95 9 987 654",
  "codAmount": 125000,
  "notes": "Back entrance",
  "lines": [
    { "sku": "WATER-1L", "description": "Water 1 L x12", "quantity": 20, "uom": "CTN", "weightKg": 240, "volumeM3": 0.4, "cases": 20, "pallets": 0.35 },
    { "sku": "RICE-5KG", "quantity": 10, "uom": "BAG", "weightKg": 50 }
  ]
}
```

**Fields:**
- `priority`: `LOW`, `NORMAL`, `HIGH` or `URGENT`.
- `weightKg`, `volumeM3`, `cases` and `pallets` are the **line totals**; the order totals are their sums. They are checked against each vehicle's capacity when loads are planned, so send them whenever you can.
- `depotCode` is the code of the FMS branch (depot) that ships the order. When it is missing, the company's default depot is used. An unknown code is a `400`.
- `deliveryDate` (`YYYY-MM-DD`, company-local) is the day the order is planned for. Default: the date of `deliveryWindow.start`, else the day the order was received.
- `address`, `latitude` and `longitude` override the customer's address for this order. Latitude and longitude go together.
- The customer is created or updated by `customer.code`.

**Responses:**

| Status | Meaning |
|---|---|
| `201` | `{ "result": "created", "order": {…} }` |
| `200` | `{ "result": "updated" }` or `{ "result": "unchanged" }`. Sending an identical payload again is a no-op, so retries are safe. |
| `400` | Field errors: `{ "message": "Validation failed", "errors": [{ "path": "lines.0.quantity", "message": "…" }] }` |
| `409` | The order is already planned or dispatched (or cancelled) and can no longer be changed. Agree a change with the dispatcher. |

### Batch — `POST /orders/batch`

```json
{ "orders": [ { "externalRef": "SO-1", "order": { …same body as PUT… } }, … ] }
```

- Up to 200 orders per request.
- Every item gets its own result (`created` / `updated` / `unchanged` / `error`, plus `status` and `errors`); one bad order does not fail the others.

### Cancel — `POST /orders/{externalRef}/cancel`

- Body: `{ "reason": "Customer closed" }`.
- Cancelling an already cancelled order returns it unchanged.
- `409` once the order is planned.

### Read

- `GET /orders/{externalRef}` returns one order.
- `GET /orders?updatedSince=2026-11-15T00:00:00Z&status=DELIVERED&limit=100` is the **changes feed**, oldest change first. While `nextCursor` is not null, call again with `&cursor=<nextCursor>`. Store the `updatedAt` of the last item as your next `updatedSince`.

### Order status

`RECEIVED → PLANNED → DISPATCHED → DELIVERED / PARTIAL / FAILED`, or `CANCELLED`.

| Status | Meaning |
|---|---|
| `PLANNED` | on a delivery load |
| `DISPATCHED` | the truck left the depot |
| `DELIVERED` | everything was delivered |
| `PARTIAL` | some quantity was delivered; see `lines[].deliveredQty` |
| `FAILED` | nothing delivered, with `failureReason`; the order goes back into planning |
| `RETURNED` | reserved for the returns flow |

`version` increases with every change. Once an order is `PLANNED`, `PUT` and `cancel` return `409`.

### Idempotency-Key

`POST` endpoints accept an `Idempotency-Key` header (8–128 characters).

- Repeating a request with the same key and the same body within 24 h returns the original response without doing the work twice.
- The same key with a different body → `422`.

## 3. Other read endpoints

| Endpoint | Scope | Returns |
|---|---|---|
| `GET /vehicles` | `vehicles:read` | id, plate, class, make/model, status, capacity |
| `GET /vehicles/positions` | `tracking:read` | latest position per vehicle |
| `GET /trips?updatedSince=&limit=` | `trips:read` | trips with status, times, distance, vehicle, driver |

## 4. Webhooks (FMS → your system)

A company admin adds an endpoint in **Integrations → Webhooks** (HTTPS only) and chooses the events. FMS sends `POST` with a JSON body:

```json
{ "id": "6f7c…", "event": "order.received", "createdAt": "2026-11-15T03:12:44.120Z", "data": { … } }
```

**Headers:**

| Header | Content |
|---|---|
| `X-FMS-Event` | the event name |
| `X-FMS-Delivery` | delivery id; the same on retries, so use it to ignore duplicates |
| `X-FMS-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` |

**Events:**

| Event | `data` |
|---|---|
| `order.received`, `order.updated`, `order.cancelled` | the order, as returned by `GET /orders/{externalRef}` |
| `order.planned`, `order.dispatched` | `externalRef`, `fmsId`, `status`, `version`, `customerCode`, `tripId` |
| `order.delivered`, `order.partially_delivered`, `order.failed` | the above plus `deliveredAt`, `reason`, `lines[]` with `quantity` and `deliveredQty`, and `pod` (below) |
| `return.collected` | a customer return picked up at a stop: `id`, `tripId`, `customerCode`, `orderExternalRef` (when linked to an order, else null), `sku`, `description`, `quantity`, `uom`, `reason`, `collectedAt` |
| `load.checked_in` | goods and cash checked back into the depot after a delivery trip: `tripId`, `tripNo`, `ok`, `shortages`, `overages`, `cashExpected`, `cashReceived`, `cashDiff`, `lines[]` (`kind` UNDELIVERED / CUSTOMER_RETURN, `ref`, `sku`, `expectedQty`, `receivedQty`, `diff`) |
| `trip.assigned`, `trip.started`, `trip.completed`, `trip.cancelled` | trip no., status, times, odometer and GPS distance, vehicle plate, driver |
| `vehicle.overspeed`, `vehicle.geofence_enter`, `vehicle.geofence_exit`, `vehicle.gps_offline` | vehicle, driver id, time, position, speed, geofence |
| `vehicle.fuel_drop` | same fields; `data` has `litres`, `from`, `to` (tank level in L, from the fuel sensor) |
| `vehicle.engine_fault` | same fields; `data.kind` is `DTC` (with `code`), `COOLANT_HOT` or `BATTERY_LOW` (with `value`, `limit`) |
| `stock.low` | `partId`, `partNo`, `name`, `branchId`, `store`, `qtyOnHand`, `minQty`, `suggestedOrder` (daily, at most weekly per item and store) |
| `warranty_claim.updated` | `id`, `claimNo`, `vehicleId`, `workOrderId`, `basis` (VEHICLE / PART / TIRE), `status`, `amountClaimed`, `amountApproved`, `amountRecovered` |
| `vehicle.off_route` | same fields; `data` has `tripId`, `tripNo`, `distanceM` (from the planned route) and `limitM` |
| `vehicle.unauthorised_use` | same fields; `type` is `UNAUTHORISED_MOVEMENT` (no ongoing trip, `data.km`), `AFTER_HOURS`, `NO_DRIVER` (`data.reason`) or `RESTRICTED_AREA` (`geofenceId`, `data.geofence`) |
| `inspection.failed` | inspection no., vehicle, driver, failed items |
| `approval.requested`, `approval.approved`, `approval.rejected` | kind, title, amount, status, decisions |
| `ping` | sent by **Send test** |

**Proof of delivery (`pod`)** on `order.delivered` / `order.partially_delivered`: `{ "photos": 2, "signedBy": "Daw Hla", "codCollected": 125000, "flags": ["FAR_FROM_CUSTOMER"] }`. Flags: `FAR_FROM_CUSTOMER` (GPS position farther than the company limit from the customer), `NO_GPS`, `COD_SHORT`, `COD_OVER`, `RECORDED_BY_DISPATCH` (entered in the console, not by the driver). Photos and the signature are viewed in FMS.

**Delivery and retries:**
- Answer with any `2xx` within 10 seconds. Redirects are not followed.
- Other answers and timeouts are retried after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h and 12 h, then marked failed. An admin can redeliver any delivery.
- After 20 consecutive failures the endpoint is disabled and the admins are notified.
- Events can arrive out of order: use `createdAt` or the order `version`.

### Verify the signature (Node.js)

```js
const crypto = require('crypto');
function verify(rawBody, header, secret, toleranceSec = 300) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

### Verify the signature (Python)

```python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Use the **raw** request body, before any JSON parsing.
