# Stockroom WMS

This is the working implementation of the supplied Stockroom Next.js template, copied from `C:\Users\U10050\Desktop\Priyant\Project`. The original folder is unchanged. The original CSS, colors, sidebar, metric cards, tables, responsive shell and branding are retained; operational pages extend them.

## Run

Node.js 22.18 or later is required (tested with Node 26).

```powershell
cd C:\Users\U10050\Documents\ChatGPT\WMS\stockroom
npm.cmd install --cache .npm-cache
npm.cmd run dev -- --hostname 127.0.0.1 --port 3010
```

Open http://localhost:3010. For production-mode local use run `npm.cmd run build`, then `npm.cmd run start -- --hostname 127.0.0.1 --port 3010`.

Authentication is off in this local WMS deployment. The application selects an active administrator by default, and the active user can be switched from the interface for role and audit demonstrations. Do not expose this deployment to an untrusted network without adding authentication.

## Implemented scope and rules

Requirement gap fixes now included: receiving scan sessions with expected-versus-scanned reconciliation and one-time confirmation; warehouse and receiving-location selection; natural A–Z sorting; multi-line orders with Customer Order and Personal Shop Order types; explicit warehouse-routed FEFO reservations; row-and-column location maps; best-fit put-away recommendations; connected multi-line pick and pack validation; purchase-order send/partial-receive/close linkage; inventory bucket summaries; and Store Transfer approval, warehouse-to-store picking/packing, in-transit handling, destination discrepancy capture, and shop-to-shop support. Transfers reduce source stock only at dispatch and add destination stock only at receipt confirmation; shortages are audited.

- Receiving: suppliers, expected/received/damaged quantities, partial receipts, quality inspection, batch/expiry, exception reasons, GRN references and receipt history. Failed quality and damaged quantities are recorded outside usable inventory.
- Put Away: tasks derived from receiving lots, partial put away, exact product/location barcode verification and destination capacity checking.
- Available Stock: stock is unavailable while at RECEIVING, expired or reserved. Orders reserve earliest-expiring eligible stock first (FEFO).
- Picking: task assignment, picker access, barcode validation, actual quantity, unavailable/short picks and reason capture. Unpicked reservations are released.
- Packing: picked-product and quantity verification, packaging materials, dimensions, weight and printable package-reference documents.
- Dispatch: packed-goods verification, carrier/tracking, shipment documents, transit/delivered/exception updates. Physical stock is deducted once, at dispatch; picking does not deduct it again.
- Cancellation: reserved, picked and packed orders release reservations. Dispatched orders use the returns workflow.
- Inventory controls: batch/expiry, low-stock alerts, location tracking, replenishment to pick faces, downward adjustments, cycle counts (up or down), and transfers between locations/warehouses. Counts, adjustments, transfers and replenishment require a different supervisor/admin to approve; reserved stock and location capacity are protected at commit.
- Returns: partial returns, cumulative shipped-quantity checks, inspection reason, quarantine and restock. Restock goes to RECEIVING and requires put away.
- Master data: products, warehouses, locations, suppliers, and user creation with roles. Warehouse stock is visible across both seeded warehouses.
- Reports: actual dashboard metrics, daily recorded operation counts, location utilization, exception alerts, stock ledger, actor/timestamp audit history, JSON reports and CSV inventory/movement exports.
- Integrations: manual ERP and POS JSON imports with event IDs, duplicate protection, failure logs and retry. ERP/POS stock/movement exports and ESL price/promotion/pick-face-stock feeds are downloadable. Ownership and exchange direction are stated in the Integrations screen.

Every mutation is validated on the server. Transaction computation uses a copy; failed operations do not commit inventory changes. After each transaction, physical quantities, reservations and order allocations must reconcile. Single-process synchronous local writes and atomic file replacement protect this local deployment.

## Demonstration walkthrough

1. Open the WMS (the administrator is selected by default). Open Warehouse to see product barcodes (e.g. WH-2401-BLK = 89010001) and locations (A-01, P-01, B-01, S-01).
2. Receive a shipment with a supplier, product, quantities, passed inspection, batch and future expiry. Goods appear at RECEIVING and are not available.
3. Put Away: select the receiving lot, quantity, destination, product barcode and matching location barcode. Available stock increases.
4. Orders: create a customer order. Available stock decreases and reserved stock increases; physical stock stays unchanged.
5. Picking: assign the order to operator, then confirm the actual pick with the product barcode. Admin can also pick for demonstrations. Short picks require a reason.
6. Packing: verify the picked quantity and product barcode, and enter packaging, dimensions and weight. Use Documents for the picking list / package reference.
7. Dispatch: verify packed quantity, record courier and tracking. Physical and reserved stock decrease together exactly once. Update delivery status.
8. Returns: inspect a shipped order and restock or quarantine a quantity. Restocked returns appear in Put Away.
9. Inventory: request a count/adjustment/transfer/replenishment. Switch the active user to a different supervisor, then review it. The requester cannot approve their own request.
10. Reports: export the ledger and inspect the audit trail.

## Integration payloads

Enable a manual connector, then choose Import / retry. Use an external event ID that remains the same across retries. Failed events do not mutate stock. Correct the payload and retry with the same ID. Completed IDs cannot be replayed.

ERP purchase order:

```json
{
  "entity": "Purchase order",
  "id": "PO-100",
  "supplier": "SUP-01",
  "product": "WH-2401-BLK",
  "qty": 10
}
```

ERP sales order (POS uses `"entity":"Sale"`):

```json
{
  "entity": "Sales order",
  "customer": "External customer",
  "product": "WH-2401-BLK",
  "qty": 3
}
```

ERP product:

```json
{
  "entity": "Product",
  "id": "SKU-NEW",
  "name": "New product",
  "category": "General",
  "barcode": "89019999",
  "minimum": 5,
  "price": 100,
  "promotion": ""
}
```

ERP supplier:

```json
{ "entity": "Supplier", "id": "SUP-NEW", "name": "New supplier" }
```

POS store stock:

```json
{
  "entity": "Store stock",
  "store": "STORE-01",
  "product": "WH-2401-BLK",
  "qty": 20
}
```

POS customer return (use an existing dispatched WMS order ID):

```json
{
  "entity": "Customer return",
  "order": "ORD-replace",
  "qty": 1,
  "disposition": "Restock",
  "batch": "RETURN-01",
  "expiry": "2029-01-01",
  "reason": "Unopened"
}
```

Quarantined returns use `"disposition":"Quarantine"` and do not require batch/expiry.

## Validation

```powershell
node --test tests/wms.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
```

The 28 domain tests exercise receiving/QC, put away, FEFO, reservation protection, single dispatch deduction, invalid transitions, cancellation, short picks, roles, capacity, second review, count/transfer/replenishment, returns, duplicate imports, purchase-order reconciliation, warehouse-to-store transfer lifecycle, and atomic failures. The API smoke test is in `tests/api-smoke.mjs` and requires the running app plus an isolated data directory to avoid changing working data.

## Release boundaries and remaining external decisions

This release is a functional local application, not a production-certified warehouse deployment. Live ERP/POS/ESL transport, vendor credentials, scheduled synchronization and physical printer/scanner certification require the actual vendors and operating environment. The adapters expose manual exchange; no external integration is represented as connected.

Orders currently contain one SKU per order, one package and one shipment. Fulfillment reserves globally across eligible lots rather than a selected warehouse. Multi-line orders, warehouse routing, unit conversions, pallets/serial numbers, multi-package shipping, supplier purchase-order reconciliation, carrier APIs and GS1/thermal label formats require further business requirements. GRNs and shipping labels use internal references; package references are human-readable rather than a certified carrier barcode format. Barcode-wedge scanners can enter the product and location text fields.

Master data supports creation and editing, including price/promotion changes and location capacity changes. Admins can update staff names, roles and status; their own admin access cannot be revoked. Quarantine is an exception record rather than a separately located quarantine stock ledger. Receiving shortages are recorded on the receipt; subsequent deliveries are new receipts. Picking identifies allocated locations on the picking document; stock stays attributed to those locations until dispatch.

Authentication is intentionally disabled for this local WMS deployment. The application opens directly and uses the active administrator as the audit actor; the optional `wms-actor` cookie can select another active staff member for development and testing. Before a shared production release: use managed authentication, a transactional database with multi-process concurrency, disaster recovery, deployment TLS, monitoring and warehouse-specific acceptance testing. The file store is designed for one local app process. Warehouse count, user/device concurrency, volume targets, reservation expiry, inventory retention and integration SLAs remain deployment decisions.

Dependencies are patched to Next.js 16.4.6 and minimatch 11.0.1 to address the advisories discovered in the supplied template. The original build setting that ignored TypeScript errors has been removed.

Cycle counts capture the observed stock balance; approval is blocked if intervening physical movements changed it. Reject the stale request and recount.
