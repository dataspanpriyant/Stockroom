import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seed, execute, available, cleanupZeroQuantityLots, evaluatePlacement, inLayoutPath, layoutReference, locationPosition, lotWarehouse, placementEvaluations, productAvailability, receivingDate, storageOccupancy, storageTone, warehouseStorageTotals, warehouseTotals } from "../lib/wms.ts";
import { groupDashboardLocations, displayLocationName } from "../lib/map-groups.ts";
import { clearReceivingDraft, commitReceivingDraft, pendingBatchDuplicateErrors, readReceivingDraft, scannerKey, validateReceivingLine, writeReceivingDraft } from "../lib/receiving-scan.ts";
const admin = { id: "admin", name: "Admin", role: "Admin" },
  supervisor = { id: "supervisor", name: "Supervisor", role: "Supervisor" },
  operator = { id: "operator", name: "Picker", role: "Operator" },
  viewer = { id: "viewer", name: "Viewer", role: "Viewer" };
function initial() {
  const s = seed();
  s.users = [admin, supervisor, operator, viewer].map((u) => ({
    ...u,
    password: "unused",
    active: true,
  }));
  return s;
}
const sum = (s) => s.lots.reduce((n, l) => n + l.qty, 0);
function run(s, c, u = admin) {
  return execute(s, c, u);
}
function order(s, qty = 10) {
  s = run(s, {
    type: "order",
    customer: "Test buyer",
    product: "WH-2401-BLK",
    qty,
    warehouse: "WH-NORTH",
  });
  const o = s.orders.at(-1);
  s = run(s, { type: "assign", order: o.id, assignee: "operator" });
  return [s, o.id];
}
function picked(s, qty = 10) {
  let id;
  [s, id] = order(s, qty);
  s = run(
    s,
    { type: "pick", order: id, productBarcode: "89010001", qty },
    operator,
  );
  return [s, id];
}
function shipped(s, qty = 10) {
  let id;
  [s, id] = picked(s, qty);
  s = run(s, {
    type: "pack",
    order: id,
    qty,
    productBarcode: "89010001",
    weight: 2,
    dimensions: "20 x 20 x 10",
    material: "Carton",
  });
  s = run(s, {
    type: "dispatch",
    order: id,
    qty,
    courier: "Local carrier",
    tracking: "TEST-001",
  });
  return [s, id];
}

test("warehouse totals scope per warehouse and all warehouses", () => {
  let s = initial();
  s = run(s, {
    type: "order",
    customer: "Scoped buyer",
    product: "WH-2401-BLK",
    qty: 1,
    warehouse: "WH-NORTH",
  });
  const all = warehouseTotals(s);
  const perWarehouse = s.warehouses.map((warehouse) => warehouseTotals(s, warehouse.id));
  for (const key of ["physical", "available", "reserved", "receiving", "expired", "openOrders", "readyToShip"]) {
    assert.equal(all[key], perWarehouse.reduce((sum, totals) => sum + totals[key], 0), `${key} all-warehouse total`);
  }
  assert.equal(warehouseTotals(s, "WH-NORTH").openOrders, 1);
  assert.equal(warehouseTotals(s, "WH-SOUTH").openOrders, 0);
});
test("dashboard warehouse grouping preserves hierarchy, special and legacy locations", () => {
  const s = initial();
  s.locations.push({ id: "P1-LEGACY-01", warehouse: "WH-NORTH", capacity: 10, kind: "Storage" });
  s.locations.push({ id: "143", name: "Nashik", warehouse: "WH-NORTH", zone: "D", rack: "a1", row: 1, column: 1, capacity: 12, kind: "Storage" });
  s.locations.push({ id: "WH-NORTH/B/B%2001/R1C1", name: "R1C1", warehouse: "WH-NORTH", zone: "B", rack: "B 01", section: "B-01", row: 1, column: 1, capacity: 8, kind: "Storage" });
  s.receipts.push({ id: "RCV-GROUP", supplier: "SUP-01", product: "WH-2401-BLK", expected: 3, received: 3, damaged: 0, accepted: 3, batch: "GROUP", expiry: "2029-01-01", status: "Awaiting put away", grn: "GRN-GROUP", note: "", warehouse: "WH-NORTH", receivingLocation: "RECEIVING" });
  s.lots.push({ ...s.lots[0], id: "GROUP-RECEIVING", location: "RECEIVING", qty: 3, reserved: 0, receiptId: "RCV-GROUP" });
  const north = groupDashboardLocations(s).find((warehouse) => warehouse.id === "WH-NORTH");
  assert.equal(north.special.receiving, 3);
  assert.equal(north.special.quarantine, 0);
  assert.equal(north.legacy.some((item) => item.location.id === "P1-LEGACY-01"), true);
  assert.equal(north.zones.flatMap((zone) => zone.racks.flatMap((rack) => rack.rows.flatMap((row) => row.cells))).some((item) => item.label === "Nashik"), true);
  assert.equal(displayLocationName({ id: "WH-NORTH/B/B%2001/R1C1", name: "R1C1", warehouse: "WH-NORTH", zone: "B", rack: "B 01", section: "B-01", row: 1, column: 1, capacity: 8, kind: "Storage" }), "R1C1");
  const cells = north.zones.flatMap((zone) => zone.racks.flatMap((rack) => rack.rows.flatMap((row) => row.cells))).concat(north.legacy);
  assert.equal(north.occupancy.capacity, cells.reduce((sum, item) => sum + item.occupancy.capacity, 0));
  assert.equal(north.occupancy.occupied, cells.reduce((sum, item) => sum + item.occupancy.occupied, 0));
  assert.ok(cells.every((item) => item.status === storageTone(item.occupancy)));
  assert.equal(north.occupancy.capacity, 1130);
});
test("order product availability is scoped and uses shared available stock rules", () => {
  const s = initial();
  s.lots.push({ ...s.lots[0], id: "ORDER-EXPIRED", expiry: "2020-01-01", qty: 100, reserved: 0 });
  s.lots.push({ ...s.lots[0], id: "ORDER-RECEIVING", location: "RECEIVING", qty: 100, reserved: 0 });
  s.lots.push({ ...s.lots[0], id: "ORDER-FULLY-RESERVED", qty: 5, reserved: 5 });
  s.lots.push({ ...s.lots[0], id: "ORDER-SOUTH", location: "S-01", qty: 50, reserved: 0, expiry: "2027-01-01" });
  const north = productAvailability(s, "WH-NORTH");
  assert.equal(north.get("WH-2401-BLK").available, 200);
  assert.equal(north.get("WH-2401-BLK").earliestExpiry, "2028-12-31");
  assert.equal(north.has("ORDER-RECEIVING"), false);
  assert.equal(productAvailability(s, "WH-SOUTH").get("WH-2401-BLK").available, 50);
});
test("new orders require warehouse, isolate FEFO, cancel releases stock, and legacy orders still ship", () => {
  let s = initial();
  const before = JSON.stringify(s);
  assert.throws(() => run(s, { type: "order", customer: "Missing warehouse", product: "WH-2401-BLK", qty: 1 }), /warehouse is required/);
  assert.equal(JSON.stringify(s), before);
  s.lots.push({ ...s.lots[0], id: "ORDER-SOUTH-EARLY", location: "S-01", qty: 5, reserved: 0, expiry: "2027-01-01" });
  s = run(s, { type: "order", customer: "North buyer", product: "WH-2401-BLK", qty: 1, warehouse: "WH-NORTH" });
  assert.equal(s.orders.at(-1).warehouse, "WH-NORTH");
  assert.equal(s.orders.at(-1).allocations[0].lot, "LOT-001");
  const reservedBeforeCancel = s.lots.find((lot) => lot.id === "LOT-001").reserved;
  s = run(s, { type: "cancel", order: s.orders.at(-1).id, reason: "Test cancellation" });
  assert.equal(s.lots.find((lot) => lot.id === "LOT-001").reserved, reservedBeforeCancel - 1);
  const beforeInsufficient = JSON.stringify(s);
  assert.throws(() => run(s, { type: "order", customer: "South buyer", product: "WH-2401-BLK", qty: 6, warehouse: "WH-SOUTH" }), /Insufficient available stock in warehouse WH-SOUTH/);
  assert.equal(JSON.stringify(s), beforeInsufficient);
  s = run(s, { type: "order", customer: "Legacy buyer", product: "WH-2401-BLK", qty: 1, warehouse: "WH-NORTH" });
  const legacy = s.orders.at(-1);
  delete legacy.warehouse;
  s = run(s, { type: "assign", order: legacy.id, assignee: "operator" });
  s = run(s, { type: "pick", order: legacy.id, qty: 1, productBarcode: "89010001" }, operator);
  s = run(s, { type: "pack", order: legacy.id, qty: 1, productBarcode: "89010001", weight: 2, dimensions: "20 x 20 x 10", material: "Carton" });
  s = run(s, { type: "dispatch", order: legacy.id, qty: 1, courier: "Local carrier", tracking: "LEGACY-1" });
  assert.equal(s.orders.find((order) => order.id === legacy.id).status, "Dispatched");
});
test("receiving → put away → available: shortages and damaged units excluded", () => {
  let s = initial();
  const base = sum(s);
  s = run(s, {
    type: "receive",
    supplier: "SUP-01",
    product: "WH-2401-BLK",
    expected: 15,
    received: 12,
    damaged: 2,
    quality: "Passed",
    batch: "TEST",
    expiry: "2029-01-01",
    note: "3 missing, 2 damaged",
  });
  const lot = s.lots.at(-1);
  assert.equal(lot.qty, 10);
  assert.equal(available(lot), 0);
  assert.equal(sum(s), base + 10);
  assert.match(s.receipts[0].grn, /GRN/);
  s = run(s, {
    type: "putaway",
    lot: lot.id,
    destination: "A-01",
    qty: 10,
    productBarcode: "89010001",
    locationBarcode: "A-01",
  });
  assert.equal(available(s.lots.at(-1)), 10);
  assert.equal(s.receipts[0].status, "Stored");
});
test("multi-line receiving commits all valid lines in one transaction", () => {
  const s = run(initial(), {
    type: "receiveMultiple",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    quality: "Passed",
    status: "Accepted",
    note: "Two-line receipt",
    lines: JSON.stringify([
      { product: "WH-2401-BLK", expected: 4, received: 4, damaged: 1, rejected: 0, batch: "MULTI-A", expiry: "2029-01-01" },
      { product: "CP-1058-WHT", expected: 3, received: 3, damaged: 0, rejected: 1, batch: "MULTI-B", expiry: "2029-02-01" },
    ]),
  });
  assert.equal(s.receipts.at(-2).accepted, 3);
  assert.equal(s.receipts.at(-1).accepted, 2);
  assert.equal(s.lots.filter((lot) => ["MULTI-A", "MULTI-B"].includes(lot.batch)).length, 2);
});
test("multi-line receiving rejects one invalid line without committing any line", () => {
  const before = initial();
  const snapshot = JSON.stringify(before);
  assert.throws(() => run(before, {
    type: "receiveMultiple",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    quality: "Passed",
    status: "Accepted",
    note: "Second line invalid",
    lines: JSON.stringify([
      { product: "WH-2401-BLK", expected: 4, received: 4, damaged: 0, rejected: 0, batch: "MULTI-ROLLBACK-A", expiry: "2029-01-01" },
      { product: "UNKNOWN", expected: 3, received: 3, damaged: 0, rejected: 0, batch: "MULTI-ROLLBACK-B", expiry: "2029-02-01" },
    ]),
  }), /Receiving line 2: Record not found: UNKNOWN/);
  assert.equal(JSON.stringify(before), snapshot);
});
test("single-line receiving remains unchanged", () => {
  const s = run(initial(), {
    type: "receive",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    product: "WH-2401-BLK",
    expected: 4,
    received: 4,
    damaged: 1,
    rejected: 1,
    quality: "Passed",
    status: "Accepted",
    batch: "SINGLE-COMPAT",
    expiry: "2029-01-01",
    note: "Single-line compatibility",
  });
  assert.equal(s.receipts.at(-1).accepted, 2);
  assert.equal(s.lots.at(-1).receiptId, s.receipts.at(-1).id);
});
test("zero-quantity cleanup removes unreferenced lots and retains referenced lots", () => {
  const s = initial();
  s.lots.push({ ...s.lots[0], id: "ZERO-CLEANUP", qty: 0, reserved: 0 });
  s.transfers.push({ id: "ZERO-TRANSFER", source: "STORE-01", destination: "STORE-02", lines: [], status: "Draft", dispatchedAt: "", receivedAt: "", allocations: [{ lot: "ZERO-REFERENCED", product: s.lots[0].product, qty: 0 }] });
  s.lots.push({ ...s.lots[0], id: "ZERO-REFERENCED", qty: 0, reserved: 0 });
  const result = cleanupZeroQuantityLots(s);
  assert.deepEqual(result.removed, ["ZERO-CLEANUP"]);
  assert.deepEqual(result.retained, ["ZERO-REFERENCED"]);
  assert.ok(s.lots.some((lot) => lot.id === "ZERO-REFERENCED"));
});
test("location removal cleans zero-quantity lots but blocks active stock", () => {
  const s = initial();
  s.locations.push({ id: "ZERO-LOCATION", warehouse: "WH-NORTH", capacity: 10, kind: "Storage" });
  s.lots.push({ ...s.lots[0], id: "ZERO-LOCATION-LOT", location: "ZERO-LOCATION", qty: 0, reserved: 0 });
  const next = run(s, { type: "deleteMaster", entity: "Location", id: "ZERO-LOCATION" });
  assert.ok(!next.locations.some((location) => location.id === "ZERO-LOCATION"));
  assert.ok(!next.lots.some((lot) => lot.id === "ZERO-LOCATION-LOT"));
  const blocked = initial();
  blocked.locations.push({ id: "ACTIVE-LOCATION", warehouse: "WH-NORTH", capacity: 10, kind: "Storage" });
  blocked.lots.push({ ...blocked.lots[0], id: "ACTIVE-LOCATION-LOT", location: "ACTIVE-LOCATION", qty: 1, reserved: 0 });
  assert.throws(() => run(blocked, { type: "deleteMaster", entity: "Location", id: "ACTIVE-LOCATION" }), /Move all stock out/);
});
test("failed quality does not increase usable or physical ledger", () => {
  let s = initial();
  const n = sum(s);
  s = run(s, {
    type: "receive",
    supplier: "SUP-01",
    product: "WH-2401-BLK",
    expected: 10,
    received: 10,
    damaged: 0,
    quality: "Failed",
    batch: "QC",
    expiry: "2029-01-01",
    note: "Inspection failed",
  });
  assert.equal(sum(s), n);
  assert.equal(s.receipts[0].accepted, 0);
});
test("full fulfillment deducts physical stock exactly once at dispatch", () => {
  let s = initial();
  const base = sum(s);
  let id;
  [s, id] = picked(s);
  assert.equal(sum(s), base);
  assert.equal(s.lots[0].reserved, 10);
  s = run(s, {
    type: "pack",
    order: id,
    qty: 10,
    productBarcode: "89010001",
    weight: 2,
    dimensions: "20 x 20 x 10",
    material: "Carton",
  });
  assert.equal(sum(s), base);
  s = run(s, {
    type: "dispatch",
    order: id,
    qty: 10,
    courier: "Carrier",
    tracking: "TRACK",
  });
  assert.equal(sum(s), base - 10);
  assert.equal(s.lots[0].reserved, 0);
  assert.throws(
    () =>
      run(s, {
        type: "dispatch",
        order: id,
        qty: 10,
        courier: "Carrier",
        tracking: "TRACK",
      }),
    /packed/,
  );
  assert.equal(sum(s), base - 10);
});
test("short picks release unpicked reservations and require explanation", () => {
  let s, id;
  [s, id] = order(initial());
  assert.throws(
    () =>
      run(
        s,
        { type: "pick", order: id, qty: 6, productBarcode: "89010001" },
        operator,
      ),
    /reason/,
  );
  s = run(
    s,
    {
      type: "pick",
      order: id,
      qty: 6,
      productBarcode: "89010001",
      reason: "4 unavailable",
    },
    operator,
  );
  assert.equal(s.lots[0].reserved, 6);
  assert.equal(s.orders[0].picked, 6);
});
test("zero picks release entire reservation", () => {
  let s, id;
  [s, id] = order(initial());
  s = run(
    s,
    {
      type: "pick",
      order: id,
      qty: 0,
      productBarcode: "89010001",
      reason: "Missing",
    },
    operator,
  );
  assert.equal(s.lots[0].reserved, 0);
  assert.equal(s.orders[0].status, "Short picked");
});
test("over reservation and overselling rejected atomically", () => {
  let s, id;
  [s, id] = order(initial(), 195);
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      run(s, {
        type: "order",
        customer: "Second",
        product: "WH-2401-BLK",
        qty: 10,
        warehouse: "WH-NORTH",
      }),
    /Insufficient/,
  );
  assert.equal(JSON.stringify(s), before);
});
test("expiry and receiving stock cannot be reserved; FEFO allocation", () => {
  let s = initial();
  s.lots.push({ ...s.lots[0], id: "EXPIRED", qty: 1000, expiry: "2020-01-01" });
  s.lots.push({ ...s.lots[0], id: "EARLY", qty: 5, expiry: "2027-01-01" });
  s.lots.push({
    ...s.lots[0],
    id: "INBOUND",
    qty: 1000,
    location: "RECEIVING",
  });
  let id;
  [s, id] = order(s);
  assert.equal(s.orders[0].allocations[0].lot, "EARLY");
  assert.equal(s.orders[0].allocations[0].qty, 5);
  assert.throws(
    () =>
      run(s, {
        type: "order",
        customer: "Too much",
        product: "WH-2401-BLK",
        qty: 1000,
        warehouse: "WH-NORTH",
      }),
    /Insufficient/,
  );
});
test("expired lot quarantine moves exactly one lot and preserves reconciled totals", () => {
  let s = initial();
  s.lots.push({ ...s.lots[0], id: "EXPIRED-QUARANTINE", qty: 7, reserved: 0, expiry: "2020-01-01", location: "A-01" });
  const before = warehouseTotals(s, "WH-NORTH");
  const beforePhysical = s.lots.reduce((sum, lot) => sum + lot.qty, 0);
  s = run(s, { type: "quarantineLot", lot: "EXPIRED-QUARANTINE" });
  const lot = s.lots.find((item) => item.id === "EXPIRED-QUARANTINE");
  assert.equal(lot.location, "WH-NORTH-QUARANTINE");
  assert.equal(lot.qty, 7);
  assert.equal(lot.reserved, 0);
  assert.equal(s.lots.filter((item) => item.id === "EXPIRED-QUARANTINE").length, 1);
  assert.ok(s.events.some((event) => event.action === "quarantineLot" && event.reference === "EXPIRED-QUARANTINE"));
  const after = warehouseTotals(s, "WH-NORTH");
  assert.equal(after.physical, before.physical);
  assert.equal(after.available + after.reserved + after.receiving + after.expired, after.physical);
  assert.equal(after.expired, before.expired);
  assert.equal(s.lots.reduce((sum, item) => sum + item.qty, 0), beforePhysical);
  assert.equal(available(lot), 0);
  assert.throws(() => run(s, { type: "quarantineLot", lot: "LOT-001" }), /Only expired/);
});
test("cancellation releases picked reservations without changing physical stock", () => {
  let s, id;
  [s, id] = picked(initial());
  const base = sum(s);
  s = run(s, { type: "cancel", order: id, reason: "Customer cancellation" });
  assert.equal(sum(s), base);
  assert.equal(s.lots[0].reserved, 0);
  assert.equal(s.orders[0].status, "Cancelled");
});
test("wrong barcodes, wrong picker and out-of-order dispatch blocked", () => {
  let s, id;
  [s, id] = order(initial());
  assert.throws(
    () =>
      run(
        s,
        { type: "pick", order: id, qty: 10, productBarcode: "WRONG" },
        operator,
      ),
    /barcode/,
  );
  assert.throws(
    () =>
      run(
        s,
        { type: "pick", order: id, qty: 10, productBarcode: "89010001" },
        { ...operator, id: "other" },
      ),
    /another user/,
  );
  assert.throws(
    () =>
      run(s, {
        type: "dispatch",
        order: id,
        qty: 10,
        courier: "X",
        tracking: "X",
      }),
    /packed/,
  );
  assert.throws(
    () =>
      run(
        s,
        { type: "order", customer: "X", product: "WH-2401-BLK", qty: 1 },
        viewer,
      ),
    /role/,
  );
});
test("capacity and put away barcode enforced", () => {
  let s = initial();
  s = run(s, {
    type: "receive",
    supplier: "SUP-01",
    product: "WH-2401-BLK",
    expected: 200,
    received: 200,
    damaged: 0,
    quality: "Passed",
    batch: "CAP",
    expiry: "2029-01-01",
  });
  const lot = s.lots.at(-1);
  assert.throws(
    () =>
      run(s, {
        type: "putaway",
        lot: lot.id,
        qty: 200,
        destination: "P-01",
        productBarcode: "89010001",
        locationBarcode: "P-01",
      }),
    /capacity/,
  );
  assert.throws(
    () =>
      run(s, {
        type: "putaway",
        lot: lot.id,
        qty: 10,
        destination: "P-01",
        productBarcode: "89010001",
        locationBarcode: "BAD",
      }),
    /barcode/,
  );
});
test("second reviewer required; stock adjustment protects reservations", () => {
  let s, id;
  [s, id] = order(initial(), 195);
  s = run(
    s,
    {
      type: "request",
      kind: "Adjustment",
      lot: "LOT-001",
      qty: 10,
      reason: "Damaged",
    },
    operator,
  );
  const req = s.approvals.at(-1).id;
  assert.throws(
    () =>
      run(
        s,
        { type: "approve", request: req, decision: "Approve", reason: "OK" },
        operator,
      ),
    /role/,
  );
  assert.throws(
    () =>
      run(
        s,
        { type: "approve", request: req, decision: "Approve", reason: "OK" },
        supervisor,
      ),
    /unreserved/,
  );
  s = run(s, {
    type: "request",
    kind: "Adjustment",
    lot: "LOT-002",
    qty: 2,
    reason: "Breakage",
  });
  const req2 = s.approvals.at(-1).id;
  assert.throws(
    () =>
      run(s, {
        type: "approve",
        request: req2,
        decision: "Approve",
        reason: "OK",
      }),
    /different/,
  );
  s = run(
    s,
    { type: "approve", request: req2, decision: "Approve", reason: "Checked" },
    supervisor,
  );
  assert.equal(s.lots.find((l) => l.id === "LOT-002").qty, 38);
});
test("cycle count and transfer preserve correct stock and warehouse locations", () => {
  let s = initial();
  s = run(
    s,
    {
      type: "request",
      kind: "Cycle count",
      lot: "LOT-002",
      qty: 35,
      reason: "Counted shelf",
    },
    operator,
  );
  s = run(
    s,
    {
      type: "approve",
      request: s.approvals.at(-1).id,
      decision: "Approve",
      reason: "Checked",
    },
    supervisor,
  );
  assert.equal(s.lots[1].qty, 35);
  const base = sum(s);
  s = run(
    s,
    {
      type: "request",
      kind: "Transfer",
      lot: "LOT-002",
      qty: 5,
      destination: "S-01",
      reason: "South demand",
    },
    operator,
  );
  s = run(
    s,
    {
      type: "approve",
      request: s.approvals.at(-1).id,
      decision: "Approve",
      reason: "Checked",
    },
    supervisor,
  );
  assert.equal(sum(s), base);
  assert.equal(s.lots.at(-1).location, "S-01");
  assert.equal(s.lots.at(-1).qty, 5);
});
test("replenishment only targets pick faces", () => {
  let s = initial();
  s = run(
    s,
    {
      type: "request",
      kind: "Replenishment",
      lot: "LOT-001",
      qty: 10,
      destination: "B-01",
      reason: "Refill",
    },
    operator,
  );
  assert.throws(
    () =>
      run(
        s,
        {
          type: "approve",
          request: s.approvals.at(-1).id,
          decision: "Approve",
          reason: "Checked",
        },
        supervisor,
      ),
    /pick face/,
  );
  s = run(
    s,
    {
      type: "request",
      kind: "Replenishment",
      lot: "LOT-001",
      qty: 10,
      destination: "P-01",
      reason: "Refill",
    },
    operator,
  );
  s = run(
    s,
    {
      type: "approve",
      request: s.approvals.at(-1).id,
      decision: "Approve",
      reason: "Checked",
    },
    supervisor,
  );
  assert.equal(s.lots.at(-1).location, "P-01");
});
test("returns cannot exceed shipped stock; restock awaits put away", () => {
  let s, id;
  [s, id] = shipped(initial());
  const base = sum(s);
  s = run(s, {
    type: "return",
    order: id,
    qty: 2,
    disposition: "Restock",
    batch: "RETURN",
    expiry: "2029-01-01",
    reason: "Unopened",
  });
  assert.equal(sum(s), base + 2);
  assert.equal(available(s.lots.at(-1)), 0);
  s = run(s, {
    type: "return",
    order: id,
    qty: 3,
    disposition: "Quarantine",
    reason: "Damaged",
  });
  assert.equal(sum(s), base + 2);
  assert.throws(
    () =>
      run(s, {
        type: "return",
        order: id,
        qty: 6,
        disposition: "Quarantine",
        reason: "Extra",
      }),
    /exceeds/,
  );
});
test("integration event deduplication and invalid imports preserve stock", () => {
  let s = initial();
  s = run(s, { type: "connector", system: "ERP", enabled: true });
  const c = {
    type: "import",
    system: "ERP",
    key: "ERP-1",
    payload: {
      entity: "Sales order",
      customer: "ERP Buyer",
      product: "WH-2401-BLK",
      qty: 10,
      warehouse: "WH-NORTH",
    },
  };
  s = run(s, c);
  assert.equal(s.orders.length, 1);
  assert.throws(() => run(s, c), /already/);
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      run(s, { ...c, key: "ERP-2", payload: { ...c.payload, qty: 100000 } }),
    /Insufficient/,
  );
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.syncs[0].status, "Completed");
});
test("fractional, negative and invalid dates rejected", () => {
  const s = initial();
  for (const qty of [-1, 1.5, NaN, Infinity])
    assert.throws(() =>
      run(s, { type: "order", customer: "Bad", product: "WH-2401-BLK", qty }),
    );
  assert.throws(
    () =>
      run(s, {
        type: "receive",
        supplier: "SUP-01",
        product: "WH-2401-BLK",
        expected: 1,
        received: 1,
        damaged: 0,
        quality: "Passed",
        batch: "BAD",
        expiry: "2029-02-31",
      }),
    /Expiry/,
  );
});
test("master updates protect occupied capacity and unique barcodes", () => {
  let s = initial();
  s = run(s, {
    type: "updateMaster",
    entity: "Product",
    id: "WH-2401-BLK",
    name: "Updated headphones",
    category: "Electronics",
    barcode: "89010001",
    minimum: 20,
    price: 2499.5,
    promotion: "10% off",
  });
  assert.equal(s.products[0].price, 2499.5);
  assert.equal(s.products[0].promotion, "10% off");
  assert.throws(
    () =>
      run(s, {
        type: "updateMaster",
        entity: "Location",
        id: "A-01",
        capacity: 10,
      }),
    /occupied/,
  );
  assert.throws(
    () =>
      run(s, {
        type: "updateMaster",
        entity: "Product",
        id: "WH-2401-BLK",
        name: "X",
        category: "X",
        barcode: "89010002",
        minimum: 0,
        price: 1,
      }),
    /Barcode/,
  );
});
test("stock expiring between picking and dispatch cannot ship", () => {
  let s, id;
  [s, id] = picked(initial());
  s = run(s, {
    type: "pack",
    order: id,
    qty: 10,
    productBarcode: "89010001",
    weight: 1,
    dimensions: "10 x 10 x 10",
    material: "Carton",
  });
  s.lots[0].expiry = "2020-01-01";
  assert.throws(
    () =>
      run(s, {
        type: "dispatch",
        order: id,
        qty: 10,
        courier: "Carrier",
        tracking: "X",
      }),
    /expired/,
  );
});
test("cycle count cannot overwrite intervening stock movements", () => {
  let s = initial();
  s = run(
    s,
    {
      type: "request",
      kind: "Cycle count",
      lot: "LOT-002",
      qty: 35,
      reason: "Counted shelf",
    },
    operator,
  );
  s.lots[1].qty -= 2;
  assert.throws(
    () =>
      run(
        s,
        {
          type: "approve",
          request: s.approvals.at(-1).id,
          decision: "Approve",
          reason: "Checked",
        },
        supervisor,
      ),
    /recount/,
  );
});

test("multi-line order reserves only the selected warehouse and dispatches each line once", () => {
  let s = initial();
  s.lots.push({ id: "SOUTH-HEAD", product: "WH-2401-BLK", batch: "SOUTH", expiry: "2029-01-01", location: "S-01", qty: 50, reserved: 0 });
  s = run(s, { type: "order", orderType: "Customer Order", customer: "Multi", warehouse: "WH-NORTH", lines: JSON.stringify([{ product: "WH-2401-BLK", qty: 10 }, { product: "CP-1058-WHT", qty: 5 }]) });
  const o = s.orders.at(-1); assert.equal(o.lines.length, 2); assert.ok(o.allocations.every((a) => ["LOT-001", "LOT-002"].includes(a.lot)));
  s = run(s, { type: "assign", order: o.id, assignee: "operator" });
  s = run(s, { type: "pick", order: o.id, productBarcode: "89010001", qty: 10 }, operator);
  s = run(s, { type: "pick", order: o.id, productBarcode: "89010002", qty: 5 }, operator);
  s = run(s, { type: "pack", order: o.id, productBarcode: "89010001", qty: 10, weight: 1, dimensions: "10x10x10", material: "Carton" });
  s = run(s, { type: "pack", order: o.id, productBarcode: "89010002", qty: 5, weight: 1, dimensions: "10x10x10", material: "Carton" });
  const before = s.lots.reduce((n, l) => n + l.qty, 0);
  s = run(s, { type: "dispatch", order: o.id, qty: 15, courier: "Carrier", tracking: "ML-1" });
  assert.equal(s.lots.reduce((n, l) => n + l.qty, 0), before - 15);
});

test("personal shop order and shop transfer preserve in-transit stock", () => {
  let s = initial();
  s.storeStock = [{ store: "STORE-01", product: "WH-2401-BLK", qty: 20 }];
  s = run(s, { type: "transfer", action: "create", source: "STORE-01", destination: "STORE-02", lines: JSON.stringify([{ product: "WH-2401-BLK", qty: 7 }]) });
  const transfer = s.transfers.at(-1); s = run(s, { type: "transfer", action: "approve", transfer: transfer.id }, supervisor); s = run(s, { type: "transfer", action: "dispatch", transfer: transfer.id });
  assert.equal(s.storeStock.find((x) => x.store === "STORE-01").qty, 13); assert.equal(s.storeStock.find((x) => x.store === "STORE-02"), undefined);
  s = run(s, { type: "transfer", action: "receive", transfer: transfer.id, received: JSON.stringify([{ product: "WH-2401-BLK", qty: 6 }]) });
  assert.equal(s.storeStock.find((x) => x.store === "STORE-02").qty, 6);
});

test("receiving scan session increments known barcodes and confirms once", () => {
  let s = initial();
  s = run(s, { type: "receiveScan", action: "start", supplier: "SUP-01", warehouse: "WH-NORTH", receivingLocation: "RECEIVING", expected: JSON.stringify([{ product: "WH-2401-BLK", qty: 3 }, { product: "CP-1058-WHT", qty: 2 }]) });
  const session = s.receivingSessions.at(-1).id;
  s = run(s, { type: "receiveScan", action: "scan", session, barcode: "89010001", qty: 2 });
  s = run(s, { type: "receiveScan", action: "scan", session, barcode: "89010001", qty: 1 });
  s = run(s, { type: "receiveScan", action: "scan", session, barcode: "89010002", qty: 1 });
  assert.throws(() => run(s, { type: "receiveScan", action: "scan", session, barcode: "UNKNOWN", qty: 1 }), /Unknown/);
  s = run(s, { type: "receiveScan", action: "scan", session, barcode: "89010003", qty: 1 });
  s = run(s, { type: "receiveScan", action: "verify", session }, supervisor);
  s = run(s, { type: "receiveScan", action: "confirm", session, expiry: "2029-01-01", additionalReason: "Unplanned item accepted" });
  const totalAfter = s.lots.filter((l) => l.location === "RECEIVING").reduce((n, l) => n + l.qty, 0);
  assert.equal(totalAfter, 5); assert.equal(s.receivingSessions.find((x) => x.id === session).confirmed, true);
  assert.throws(() => run(s, { type: "receiveScan", action: "confirm", session, expiry: "2029-01-01", additionalReason: "Retry" }), /already/);
});

test("warehouse map validates receiving warehouse, blocked capacity and SKU assignments", () => {
  let s = initial();
  const command = {
    type: "master", entity: "Location", id: "MAP-01", name: "Test bin",
    warehouse: "WH-NORTH", zone: "Map", rack: "01", row: 1, shelf: 1,
    column: 1, capacity: 12, kind: "Storage", blocked: "Blocked", mapCreate: true, mapMode: "zone",
  };
  s = run(s, command);
  assert.throws(() => run(s, { ...command, id: "MAP-02", mapMode: "column" }), /occupies this position/);
  const receipt = {
    type: "receive", supplier: "SUP-01", product: "WH-2401-BLK", warehouse: "WH-NORTH",
    expected: 10, received: 10, damaged: 0, quality: "Passed", batch: "MAP-RECEIPT", expiry: "2029-01-01",
  };
  s = run(s, receipt);
  const lot = s.lots.at(-1);
  const place = {
    type: "putaway", lot: lot.id, qty: 6, productBarcode: "89010001", fromMap: true,
    destination: "MAP-01", locationBarcode: "MAP-01",
  };
  assert.throws(() => run(s, place, operator), /blocked/);
  assert.throws(() => run(s, { ...place, destination: "S-01", locationBarcode: "S-01" }, operator), /receiving warehouse/);
  s = run(s, { type: "updateMaster", entity: "Location", id: "MAP-01", capacity: 12, blocked: "Open" });
  s = run(s, place, operator);
  assert.equal(s.lots.find((item) => item.id === lot.id).qty, 4);
  assert.equal(s.locations.find((item) => item.id === "MAP-01").assignedProduct, lot.product);
  assert.equal(s.receipts.find((item) => item.id === lot.receiptId).status, "Awaiting put away");
  s = run(s, { ...receipt, product: "CP-1058-WHT" });
  const other = s.lots.at(-1);
  assert.throws(() => run(s, { ...place, lot: other.id, productBarcode: s.products.find((item) => item.id === other.product).barcode }), /another SKU/);
  s = run(s, { ...command, id: "MAP-LATER", zone: "Z", blocked: "Open" });
  assert.throws(() => run(s, {
    ...place, lot: other.id, destination: "MAP-LATER", locationBarcode: "MAP-LATER",
    productBarcode: s.products.find((item) => item.id === other.product).barcode,
  }), /alphabetical order/);
  s = run(s, { type: "editMapGroup", warehouse: "WH-NORTH", zone: "Z", remove: true });
  assert.ok(!s.locations.some((item) => item.id === "MAP-LATER"));
  const group = { type: "editMapGroup", warehouse: "WH-NORTH", zone: "Map", rack: "01" };
  assert.throws(() => run(s, { ...group, remove: true }), /Move all stock/);
  s = run(s, { ...group, to: "02" });
  assert.equal(s.locations.find((item) => item.id === "MAP-01").rack, "02");
  s = run(s, { ...place, qty: 4 }, operator);
  assert.equal(s.receipts.find((item) => item.id === lot.receiptId).status, "Stored");
  assert.equal(s.receipts.find((item) => item.id === other.receiptId).status, "Awaiting put away");
});

test("direct API put-away applies map rules to unassigned locations", () => {
  let s = initial();
  s.locations.push({ id: "DIRECT-MIX", warehouse: "WH-NORTH", zone: "Direct", rack: "01", row: 1, column: 1, capacity: 20, kind: "Storage" });
  s.lots.push({ ...s.lots[0], id: "DIRECT-MIX-STOCK", product: "CP-1058-WHT", location: "DIRECT-MIX", qty: 2, reserved: 0 });
  s = run(s, { type: "receive", supplier: "SUP-01", product: "WH-2401-BLK", warehouse: "WH-NORTH", expected: 5, received: 5, damaged: 0, quality: "Passed", batch: "DIRECT-RULE", expiry: "2029-01-01" });
  const lot = s.lots.at(-1);
  assert.throws(() => run(s, { type: "putaway", lot: lot.id, qty: 5, destination: "DIRECT-MIX", productBarcode: "89010001", locationBarcode: "DIRECT-MIX" }, operator), /another SKU/);
  s.locations.push({ id: "DIRECT-VALID", warehouse: "WH-NORTH", zone: "Direct", rack: "02", row: 1, column: 1, capacity: 20, kind: "Storage", assignedProduct: "WH-2401-BLK" });
  s = run(s, { type: "putaway", lot: lot.id, qty: 5, destination: "DIRECT-VALID", productBarcode: "89010001", locationBarcode: "DIRECT-VALID" }, operator);
  assert.equal(s.lots.find((item) => item.id === lot.id).qty, 0);
  assert.equal(s.lots.at(-1).location, "DIRECT-VALID");
});

test("placement evaluations match real put-away acceptance and rank highlights", () => {
  let s = initial();
  s = run(s, { type: "receive", supplier: "SUP-01", product: "WH-2401-BLK", warehouse: "WH-NORTH", expected: 10, received: 10, damaged: 0, quality: "Passed", batch: "HIGHLIGHT-BATCH", expiry: "2029-01-01" });
  const lot = s.lots.at(-1);
  const locations = [
    { id: "HIGHLIGHT-SAME", warehouse: "WH-NORTH", zone: "Highlight", rack: "01", row: 1, column: 1, capacity: 20, kind: "Storage", assignedProduct: "WH-2401-BLK" },
    { id: "HIGHLIGHT-ASSIGNED", warehouse: "WH-NORTH", zone: "Highlight", rack: "01", row: 1, column: 2, capacity: 20, kind: "Storage", assignedProduct: "WH-2401-BLK" },
    { id: "HIGHLIGHT-PARTIAL", warehouse: "WH-NORTH", zone: "Highlight", rack: "01", row: 1, column: 3, capacity: 5, kind: "Storage", assignedProduct: "WH-2401-BLK" },
    { id: "HIGHLIGHT-BLOCKED", warehouse: "WH-NORTH", zone: "Highlight", rack: "01", row: 1, column: 4, capacity: 20, kind: "Storage", assignedProduct: "WH-2401-BLK", blocked: true },
    { id: "HIGHLIGHT-OTHER", warehouse: "WH-NORTH", zone: "Highlight", rack: "01", row: 1, column: 5, capacity: 20, kind: "Storage", assignedProduct: "CP-1058-WHT" },
  ];
  s.locations.push(...locations);
  s.lots.push({ ...lot, id: "HIGHLIGHT-EXISTING", location: "HIGHLIGHT-SAME", qty: 2, reserved: 0 });
  s.lots.push({ ...lot, id: "HIGHLIGHT-MIXED", location: "HIGHLIGHT-ASSIGNED", batch: "OLD-BATCH", expiry: "2028-01-01", qty: 1, reserved: 0 });
  const evaluations = placementEvaluations(s, lot, locations);
  const byId = new Map(evaluations.map((evaluation) => [evaluation.location.id, evaluation]));
  assert.equal(byId.get("HIGHLIGHT-SAME").tier, "best");
  assert.equal(byId.get("HIGHLIGHT-SAME").warning, "");
  assert.equal(byId.get("HIGHLIGHT-ASSIGNED").tier, "best");
  assert.equal(byId.get("HIGHLIGHT-ASSIGNED").warning, "Mixes batches");
  assert.equal(byId.get("HIGHLIGHT-PARTIAL").tier, "partial");
  assert.match(byId.get("HIGHLIGHT-PARTIAL").reason, /Fits 5 of 10/);
  assert.equal(byId.get("HIGHLIGHT-BLOCKED").tier, "not-possible");
  assert.equal(byId.get("HIGHLIGHT-OTHER").tier, "not-possible");
  assert.equal(evaluations[0].location.id, "HIGHLIGHT-SAME");
  assert.equal(evaluations[1].location.id, "HIGHLIGHT-ASSIGNED");

  for (const evaluation of evaluations) {
    const command = { type: "putaway", lot: lot.id, qty: evaluation.tier === "partial" ? evaluation.free : lot.qty, destination: evaluation.location.id, productBarcode: "89010001", locationBarcode: evaluation.location.id };
    if (evaluation.tier === "not-possible") assert.throws(() => run(s, command, operator), /blocked|another SKU/);
    else assert.doesNotThrow(() => run(s, command, operator));
  }
  const otherLot = { ...lot, id: "HIGHLIGHT-OTHER-LOT", product: "CP-1058-WHT", batch: "OTHER", expiry: "2029-02-01" };
  const changed = evaluatePlacement(s, otherLot, locations[1]);
  assert.equal(changed.tier, "not-possible");
});

test("row and group removal protect historically referenced lots and allow empty rows", () => {
  const rack = { warehouse: "WH-NORTH", zone: "Reference safety", rack: "R1" };
  const section = { ...rack, section: "R1-01" };
  let s = run(initial(), { type: "configureRack", ...rack, create: true, rows: 2, columns: 1, capacity: 10 });
  const first = s.locations.find((location) => location.warehouse === rack.warehouse && location.zone === rack.zone && locationPosition(location).row === 1);
  const second = s.locations.find((location) => location.warehouse === rack.warehouse && location.zone === rack.zone && locationPosition(location).row === 2);
  const referencedLot = { ...s.lots[0], id: "REFERENCED-HISTORY", location: first.id, qty: 0, reserved: 0 };
  s.lots.push(referencedLot);
  s.orders.push({ id: "HISTORICAL-ORDER", customer: "History", product: referencedLot.product, qty: 1, picked: 1, allocations: [{ lot: referencedLot.id, product: referencedLot.product, qty: 1 }], status: "Dispatched", assignee: "", weight: 0, dimensions: "", material: "", courier: "", tracking: "", delivery: "", orderType: "Customer Order", lines: [{ product: referencedLot.product, qty: 1, picked: 1, packed: 1 }], backordered: 0, createdBy: "Admin", createdAt: new Date().toISOString() });
  const before = JSON.stringify(s);
  assert.throws(() => run(s, { type: "configureLayoutSection", ...section, removeAxis: "row", row: 1 }), /still referenced/);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => run(s, { type: "configureLayoutSection", ...section, remove: true }), /still referenced/);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => run(s, { type: "editMapGroup", ...rack, remove: true }), /still referenced/);
  assert.equal(JSON.stringify(s), before);
  s = run(s, { type: "configureLayoutSection", ...section, removeAxis: "row", row: 2 });
  assert.ok(!s.locations.some((location) => location.id === second.id));
});

test("rack grids generate independent units and protect inventory and assignments on resize or removal", () => {
  const rack = { type: "configureRack", warehouse: "WH-NORTH", zone: "Test", rack: "R01", capacity: 20 };
  const secondRack = { ...rack, rack: "R02", rows: 1, columns: 2 };
  const prefix = "WH-NORTH/Test/R01/";
  const unit = (id) => prefix + id;
  let s = run(initial(), { ...rack, create: true, rows: 3, columns: 3 });
  assert.deepEqual(s.locations.filter((location) => location.zone === "Test").map((location) => location.id),
    ["R1C1", "R1C2", "R1C3", "R2C1", "R2C2", "R2C3", "R3C1", "R3C2", "R3C3"].map(unit));
  s = run(s, { ...secondRack, create: true });
  const otherUnits = s.locations.filter((location) => location.zone === "Test" && location.rack === "R02");
  const update = { type: "updateMaster", entity: "Location", id: unit("R3C3"), capacity: 25 };
  s = run(s, { ...update, assignedProduct: "WH-2401-BLK" });
  const shrink = { ...rack, rows: 2, columns: 3, capacity: 30 };
  const remove = { type: "deleteMaster", entity: "Location", id: unit("R3C3") };
  assert.throws(() => run(s, shrink), /product assignments/);
  assert.throws(() => run(s, remove), /product assignments/);
  s = run(s, { ...update, assignedProduct: "" });
  const stocked = { ...s.lots[0], id: "rack-test-lot", location: unit("R3C3"), qty: 4, reserved: 0 };
  s.lots.push(stocked);
  assert.throws(() => run(s, shrink), /before resizing/);
  assert.throws(() => run(s, remove), /Move all stock/);
  assert.throws(() => run(s, { ...rack, type: "editMapGroup", remove: true }), /Move all stock/);
  s = run(s, { ...rack, rows: 4, columns: 3, capacity: 30 });
  assert.deepEqual(s.lots.find((lot) => lot.id === stocked.id), stocked);
  assert.equal(s.locations.find((location) => location.id === unit("R3C3")).capacity, 25);
  assert.equal(s.locations.find((location) => location.id === unit("R4C1")).capacity, 30);
  assert.deepEqual(s.locations.filter((location) => location.zone === "Test" && location.rack === "R02"), otherUnits);
  s = run(s, { ...remove, id: unit("R4C1") });
  s = run(s, { ...remove, id: unit("R4C2") });
  s = run(s, { ...rack, restoreRow: 4, restoreColumn: 1 });
  assert.ok(s.locations.some((location) => location.id === unit("R4C1")));
  assert.ok(!s.locations.some((location) => location.id === unit("R4C2")));
  s = run(s, { ...secondRack, type: "editMapGroup", remove: true });
  assert.ok(!s.rackGrids.some((grid) => grid.zone === "Test" && grid.rack === "R02"));
  assert.ok(!s.locations.some((location) => location.zone === "Test" && location.rack === "R02"));
});

test("warehouse layout saves scoped geometry and keeps stable sections and unit IDs after renames", () => {
  const zone = { warehouse: "WH-NORTH", zone: "Layout A" };
  const rack = { ...zone, rack: "R10" };
  const rect = { x: 2, y: 4, width: 440, height: 280 };
  let s = run(initial(), { type: "createLayoutZone", ...zone, ...rect });
  s = run(s, { type: "configureRack", ...rack, create: true, layout: true, rows: 2, columns: 2, capacity: 12 });
  s = run(s, { type: "configureLayoutSection", ...rack, section: "R11-01", create: true, rows: 2, columns: 1, capacity: 40 });
  const section = { ...rack, section: "R11-01" };
  const extraUnits = s.locations.filter((unit) => inLayoutPath(unit, section));
  assert.deepEqual(extraUnits.map((unit) => unit.capacity), [20, 20]);
  const save = { type: "saveWarehouseLayout", warehouse: zone.warehouse, blocks: [
    { zone: zone.zone, ...rect, x: 36, expected: rect },
    { zone: zone.zone, rack: rack.rack, x: 18, y: 24, width: 265, height: 138, expected: null },
  ] };
  assert.throws(() => run(s, save, viewer), /cannot perform/);
  s = run(s, save);
  assert.throws(() => run(s, save), /updated elsewhere/);
  s = JSON.parse(JSON.stringify(s));
  s = run(s, { type: "editMapGroup", ...rack, to: "R11" });
  assert.equal(s.layoutBlocks.find((block) => block.rack === "R11").x, 18);
  assert.equal(s.layoutBlocks.find((block) => !block.rack).x, 36);
  assert.equal(s.rackGrids.find((grid) => grid.rack === "R11").section, "R10-01");
  assert.deepEqual(s.locations.filter((unit) => inLayoutPath(unit, { ...section, rack: "R11" })).map((unit) => unit.id),
    extraUnits.map((unit) => unit.id));
  const renamedRack = { ...zone, rack: "R11" };
  s = run(s, { type: "configureLayoutSection", ...renamedRack, section: "R11-01", remove: true });
  assert.equal(s.locations.filter((unit) => inLayoutPath(unit, renamedRack)).length, 4);
  s = run(s, { type: "editMapGroup", ...renamedRack, remove: true });
  assert.ok(!s.layoutBlocks.some((block) => block.rack === "R11"));
  assert.ok(s.layoutBlocks.some((block) => block.zone === zone.zone));
});

test("row putaway splits stock across compatible bins and protects occupied row and section capacity", () => {
  const section = { warehouse: "WH-NORTH", zone: "Row flow", rack: "R20", section: "S2" };
  let s = run(initial(), { type: "configureRack", ...section, create: true, rows: 1, columns: 1, capacity: 15 });
  s = run(s, { type: "configureLayoutSection", ...section, create: true, rows: 2, columns: 2, capacity: 20 });
  const row = { ...section, row: 2 };
  s = run(s, { type: "setLayoutRowCapacity", ...row, capacity: 12 });
  s = run(s, {
    type: "receive", supplier: "SUP-01", product: "WH-2401-BLK", warehouse: section.warehouse,
    expected: 14, received: 14, damaged: 0, quality: "Passed", batch: "ROW-FLOW", expiry: "2029-01-01",
  });
  const lot = s.lots.at(-1);
  const place = { type: "putawayRow", ...row, lot: lot.id, qty: 13, productBarcode: "89010001", locationBarcode: layoutReference(row) };
  assert.throws(() => run(s, place, operator), /insufficient compatible capacity/);
  assert.equal(s.lots.find((item) => item.id === lot.id).qty, 14);
  s = run(s, { ...place, qty: 10 }, operator);
  const rowUnits = s.locations.filter((unit) => inLayoutPath(unit, row));
  const placed = s.lots.filter((item) => item.receiptId === lot.receiptId && item.location !== "RECEIVING");
  assert.equal(placed.length, 2);
  assert.ok(placed.every((item) => rowUnits.some((unit) => unit.id === item.location)));
  assert.equal(placed.reduce((sum, item) => sum + item.qty, 0), 10);
  const inventory = storageOccupancy(s);
  const rowSummary = inventory.group(row.warehouse, row);
  assert.deepEqual(rowSummary, { capacity: 12, occupied: 10, available: 2, excess: 0 });
  assert.equal(inventory.group(row.warehouse, section).occupied,
    rowSummary.occupied + inventory.group(row.warehouse, { ...row, row: 1 }).occupied);
  assert.equal(inventory.group(row.warehouse, { ...section, section: undefined }).occupied, 10);
  assert.equal(inventory.group(row.warehouse, { ...section, rack: undefined, section: undefined }).occupied, 10);
  assert.equal(inventory.group(row.warehouse).occupied - storageOccupancy(initial()).group(row.warehouse).occupied, 10);
  const legacy = structuredClone(s);
  legacy.locations.find((unit) => unit.id === placed[0].location).capacity -= 1;
  assert.equal(storageOccupancy(legacy).group(row.warehouse, row).excess, 1);
  assert.equal(s.lots.find((item) => item.id === lot.id).qty, 4);
  assert.throws(() => run(s, { type: "setLayoutRowCapacity", ...row, capacity: 9 }), /occupied stock/);
  assert.throws(() => run(s, { type: "configureLayoutSection", ...section, rows: 1, columns: 2, capacity: 20 }), /before resizing/);
  assert.throws(() => run(s, { type: "configureLayoutSection", ...section, remove: true }), /Move all stock/);
});

test("adding rack rows and columns preserves existing capacity, allocations, and deleted slots", () => {
  const rack = { warehouse: "WH-NORTH", zone: "Expansion", rack: "R1" };
  const section = { ...rack, section: "R1-01" };
  let s = run(initial(), { type: "configureRack", ...rack, create: true, rows: 2, columns: 2, capacity: 10 });
  const existing = s.locations.filter((unit) => inLayoutPath(unit, section));
  s = run(s, { type: "deleteMaster", entity: "Location", id: existing[0].id });
  s = run(s, { type: "updateMaster", entity: "Location", id: existing[1].id, capacity: 44, assignedProduct: s.products[0].id });
  const retained = s.locations.filter((unit) => inLayoutPath(unit, section));
  s = run(s, { type: "configureLayoutSection", ...section, appendAxis: "row", count: 1, capacity: 15 });
  s = run(s, { type: "configureLayoutSection", ...section, appendAxis: "column", count: 2, capacity: 20 });
  const units = s.locations.filter((unit) => inLayoutPath(unit, section));
  assert.equal(units.length, 11);
  assert.ok(!units.some((unit) => unit.id === existing[0].id));
  assert.deepEqual(units.slice(0, retained.length), retained);
  assert.equal(units.find((unit) => unit.row === 3 && unit.column === 2).capacity, 15);
  assert.equal(units.find((unit) => unit.row === 1 && unit.column === 4).capacity, 20);
  assert.deepEqual(s.layoutSections.find((item) => item.zone === rack.zone), { ...section, rows: 3, columns: 4 });
  const expanded = run(s, { type: "configureLayoutSection", ...section, addRows: 1, addColumns: 2, capacity: 25 });
  const after = expanded.locations.filter((unit) => inLayoutPath(unit, section));
  assert.deepEqual(after.slice(0, units.length), units);
  assert.equal(after.length, 23);
  assert.equal(after.find((unit) => unit.row === 4 && unit.column === 6).capacity, 25);
  assert.ok(!after.some((unit) => unit.id === existing[0].id));
});

test("remove empty rack rows and columns without moving stock or recreating removed positions", () => {
  const rack = { warehouse: "WH-NORTH", zone: "Reduction", rack: "R1" };
  const section = { ...rack, section: "R1-01" };
  let s = run(initial(), { type: "configureRack", ...rack, create: true, rows: 3, columns: 3, capacity: 10 });
  const stockUnit = s.locations.find((unit) => inLayoutPath(unit, { ...section, row: 3 }) && unit.column === 3);
  s.lots.push({ ...s.lots[0], id: "reduction-lot", location: stockUnit.id, qty: 2, reserved: 0 });
  const command = { type: "configureLayoutSection", ...section };
  assert.throws(() => run(s, { ...command, removeAxis: "row", row: 3 }), /Move all stock/);
  assert.throws(() => run(s, { ...command, removeAxis: "column", column: 3 }), /Move all stock/);
  assert.throws(() => run(s, { ...rack, type: "editMapGroup", remove: true, stockOnly: true }), /Move all stock/);
  s = run(s, { ...command, removeAxis: "row", row: 2 });
  s = run(s, { ...command, removeAxis: "column", column: 1 });
  s = run(s, { ...command, appendAxis: "column", count: 1, capacity: 20 });
  const units = s.locations.filter((unit) => inLayoutPath(unit, section));
  assert.equal(units.length, 6);
  assert.ok(units.every((unit) => unit.row !== 2 && unit.column !== 1));
  assert.deepEqual(units.find((unit) => unit.id === stockUnit.id), stockUnit);
  assert.equal(s.lots.find((lot) => lot.id === "reduction-lot").location, stockUnit.id);
});

test("set the number of columns on an individually numbered rack row", () => {
  const rack = { warehouse: "WH-NORTH", zone: "Individual rows", rack: "R1" };
  const section = { ...rack, section: "R1-01" };
  let s = run(initial(), { type: "configureRack", ...rack, create: true, rows: 1, columns: 1, capacity: 10 });
  const command = { type: "configureLayoutSection", ...section, capacity: 20 };
  s = run(s, { ...command, targetRow: 1, columnCount: 2 });
  s = run(s, { ...command, targetRow: 3, columnCount: 1 });
  const units = s.locations.filter((unit) => inLayoutPath(unit, section));
  assert.deepEqual(units.map(({ row, column, capacity }) => [row, column, capacity]), [[1, 1, 10], [1, 2, 20], [3, 1, 20]]);
  assert.deepEqual(s.layoutSections.find((item) => item.zone === rack.zone).rowNumbers, [1, 3]);
  assert.throws(() => run(s, { ...command, targetRow: 1, columnCount: 1 }), /already has 2 columns/);
  s = run(s, { ...command, removeAxis: "row", row: 3 });
  assert.deepEqual(s.layoutSections.find((item) => item.zone === rack.zone).rowNumbers, [1]);
  s = run(s, { ...command, rowName: "Top shelf", columnCount: 2 });
  s = run(s, { ...command, rowName: "top shelf", columnCount: 3 });
  const named = s.layoutSections.find((item) => item.zone === rack.zone);
  assert.deepEqual(named.rowNumbers, [1, 4]);
  assert.equal(named.rowNames[4], "Top shelf");
  assert.equal(s.locations.filter((unit) => inLayoutPath(unit, { ...section, row: 4 })).length, 3);
});

test("purchase orders support send, partial receipt, close and receipt linkage", () => {
  let s = initial();
  s = run(s, { type: "purchaseOrder", action: "create", id: "PO-TEST-01", supplier: "SUP-01", product: "WH-2401-BLK", qty: 12 });
  assert.equal(s.purchaseOrders.at(-1).status, "Draft");
  s = run(s, { type: "purchaseOrder", action: "send", id: "PO-TEST-01" });
  s = run(s, { type: "purchaseOrder", action: "receive", id: "PO-TEST-01", qty: 5, warehouse: "WH-NORTH", quality: "Passed", batch: "PO-TEST-A", expiry: "2029-01-01", note: "Partial delivery" });
  assert.equal(s.purchaseOrders.at(-1).status, "Partially received");
  assert.equal(s.receipts.at(-1).purchaseOrder, "PO-TEST-01");
  s = run(s, { type: "purchaseOrder", action: "receive", id: "PO-TEST-01", qty: 7, warehouse: "WH-NORTH", quality: "Passed", batch: "PO-TEST-B", expiry: "2029-02-01", note: "Balance delivery" });
  assert.equal(s.purchaseOrders.at(-1).status, "Received");
  s = run(s, { type: "purchaseOrder", action: "close", id: "PO-TEST-01" });
  assert.equal(s.purchaseOrders.at(-1).status, "Closed");
});

test("warehouse to store transfer enforces approval, pick, pack, transit and receipt", () => {
  let s = initial();
  const lot = s.lots.find((item) => item.location !== "RECEIVING" && item.qty - item.reserved > 0);
  assert.ok(lot);
  const warehouse = s.locations.find((location) => location.id === lot.location).warehouse;
  s = run(s, { type: "transfer", action: "createWarehouse", sourceWarehouse: warehouse, destination: "STORE-02", lines: JSON.stringify([{ product: lot.product, qty: 1 }]) });
  const transfer = s.transfers.at(-1);
  s = run(s, { type: "transfer", action: "approve", transfer: transfer.id }, { id: "supervisor", name: "Supervisor", role: "Supervisor" });
  s = run(s, { type: "transfer", action: "pick", transfer: transfer.id });
  s = run(s, { type: "transfer", action: "pack", transfer: transfer.id });
  s = run(s, { type: "transfer", action: "dispatch", transfer: transfer.id });
  assert.equal(s.transfers.at(-1).status, "In Transit");
  s = run(s, { type: "transfer", action: "receive", transfer: transfer.id, received: JSON.stringify([{ product: lot.product, qty: 1 }]) });
  assert.equal(s.transfers.at(-1).status, "Received");
  assert.equal(s.storeStock.find((item) => item.store === "STORE-02" && item.product === lot.product)?.qty, 1);
});

test("warehouse transfer receipt rejects insufficient space and splits stock across compatible bins", () => {
  const s = initial();
  const source = s.lots[0];
  const warehouse = "WH-SOUTH";
  for (const unit of s.locations.filter((unit) => unit.warehouse === warehouse)) unit.blocked = true;
  s.locations.push(...[1, 2].map((index) => ({
    id: `TRANSFER-BIN-${index}`, warehouse, capacity: 3, kind: "Storage",
  })));
  s.transfers.push({
    id: "TRANSFER-CAPACITY", destinationType: "Warehouse", destinationWarehouse: warehouse,
    status: "In Transit", lines: [{ product: source.product, qty: 7 }],
    allocations: [{ lot: source.id, product: source.product, qty: 7 }],
  });
  const receive = { type: "transfer", action: "receive", transfer: "TRANSFER-CAPACITY" };
  assert.throws(() => run(s, receive), /insufficient compatible capacity/);
  assert.equal(s.transfers.at(-1).status, "In Transit");
  const next = run(s, { ...receive, received: JSON.stringify([{ product: source.product, qty: 5 }]), reason: "Short" });
  const occupancy = storageOccupancy(next);
  assert.equal(occupancy.unit("TRANSFER-BIN-1").occupied, 3);
  assert.equal(occupancy.unit("TRANSFER-BIN-2").occupied, 2);
  assert.equal(occupancy.group(warehouse).excess, 0);
  assert.equal(next.transfers.at(-1).status, "Received with Discrepancy");
});

test("barcode reconciliation resolves production barcode, allows same-batch top-ups, and calculates accepted stock", () => {
  let s = initial();
  s = run(s, {
    type: "receiveReconciliation",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    lines: JSON.stringify([
      { product: "WH-2401-BLK", barcode: "89010001", batch: "SCAN-A", manufacturingDate: "2026-10-01", expiry: "2029-01-01", received: 12, damaged: 2 },
      { product: "WH-2401-BLK", barcode: "89010001", batch: "SCAN-B", manufacturingDate: "2026-10-02", expiry: "2029-02-01", received: 5, damaged: 0 },
    ]),
  });
  assert.equal(s.receipts.at(-2).accepted, 10);
  assert.equal(s.receipts.at(-1).accepted, 5);
  assert.equal(s.lots.filter((lot) => lot.batch.startsWith("SCAN-")).length, 2);
  const before = s.receipts.length;
  s = run(s, {
    type: "receiveReconciliation", supplier: "SUP-01", warehouse: "WH-NORTH",
    lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "SCAN-A", expiry: "2029-01-01", received: 1, damaged: 0 }]),
  });
  assert.equal(s.receipts.length, before + 1);
  assert.equal(s.receipts.at(-1).batch, "SCAN-A");
});

test("receiving blocks different expiry in the same warehouse but allows another warehouse", () => {
  let s = initial();
  s = run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-NORTH", product: "WH-2401-BLK", expected: 2, received: 2, damaged: 0, quality: "Passed", batch: "SCOPE-BATCH", expiry: "2029-01-01" });
  assert.throws(() => run(s, { type: "receiveReconciliation", warehouse: "WH-NORTH", lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "SCOPE-BATCH", expiry: "2030-01-01", received: 1, damaged: 0 }]) }), /Wireless Headphones, batch SCOPE-BATCH already exists in Northstar Distribution Center with expiry 2029-01-01\. You entered 2030-01-01/);
  s = run(s, { type: "receiveReconciliation", warehouse: "WH-SOUTH", lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "SCOPE-BATCH", expiry: "2030-01-01", received: 1, damaged: 0 }]) });
  assert.equal(s.receipts.filter((receipt) => receipt.batch === "SCOPE-BATCH").length, 2);
});

test("one receipt may have multiple split lots without causing a batch conflict", () => {
  let s = initial();
  s = run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-NORTH", product: "WH-2401-BLK", expected: 10, received: 10, damaged: 0, quality: "Passed", batch: "SPLIT-BATCH", expiry: "2029-01-01" });
  const receipt = s.receipts.at(-1);
  const lot = s.lots.at(-1);
  s.lots.push({ ...lot, id: "SPLIT-SECOND-LOT", qty: 4, location: "B-01" });
  s = run(s, { type: "receiveReconciliation", warehouse: "WH-NORTH", lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "SPLIT-BATCH", expiry: "2029-01-01", received: 2, damaged: 0 }]) });
  assert.equal(s.receipts.filter((item) => item.batch === receipt.batch).length, 2);
});

test("pending duplicate batches flag every row and unresolved lots match no warehouse", () => {
  const lines = [
    { product: "P", barcode: "B", batch: "DUP", expiry: "2029-01-01", manufacturingDate: "", received: 1, damaged: 0, warehouse: "WH-NORTH" },
    { product: "Q", barcode: "C", batch: "OK", expiry: "2029-01-01", manufacturingDate: "", received: 1, damaged: 0, warehouse: "WH-NORTH" },
    { product: "P", barcode: "B", batch: "DUP", expiry: "2029-01-01", manufacturingDate: "", received: 1, damaged: 0, warehouse: "WH-NORTH" },
  ];
  const errors = pendingBatchDuplicateErrors(lines);
  assert.equal(errors[0], "Rows 1 and 3 use the same batch");
  assert.equal(errors[1], "");
  assert.equal(errors[2], "Rows 1 and 3 use the same batch");
  const s = initial();
  assert.equal(lotWarehouse(s, { id: "UNRESOLVED", product: "P", batch: "B", expiry: "2029-01-01", location: "MISSING", qty: 1, reserved: 0 }), undefined);
});

test("failed reconciliation identifies its line and leaves state unchanged", () => {
  const s = initial();
  const before = JSON.stringify(s);
  assert.throws(() => run(s, {
    type: "receiveReconciliation", warehouse: "WH-NORTH",
    lines: JSON.stringify([
      { product: "WH-2401-BLK", barcode: "89010001", batch: "ATOMIC-BATCH", expiry: "2029-01-01", received: 1, damaged: 0 },
      { product: "WH-2401-BLK", barcode: "89010001", batch: "ATOMIC-BATCH", expiry: "2030-01-01", received: 1, damaged: 0 },
    ]),
  }), /Receiving line 2: Wireless Headphones, batch ATOMIC-BATCH/);
  assert.equal(JSON.stringify(s), before);
});

test("all Sample Dataset products can be registered for production receiving", () => {
  let s = initial();
  const sampleCount = s.sampleProducts.length;
  run(s, { type: "registerSampleProducts" });
  s = run(s, { type: "registerSampleProducts" });
  assert.equal(s.sampleProducts.length, 0);
  assert.equal(s.products.length, initial().products.length + sampleCount);
  assert.ok(s.products.some((product) => product.id === "SAMPLE-MILK" && product.barcode === "100003"));
  assert.equal(s.products.find((product) => product.id === "SAMPLE-MILK")?.defaultExpiry, "2026-11-25");
});

test("barcode reconciliation uses Unspecified without a supplier and preserves explicit, legacy, and PO suppliers", () => {
  let s = initial();
  const legacy = { id: "LEGACY-RECEIPT", supplier: "SUP-01", product: "WH-2401-BLK", expected: 1, received: 1, damaged: 0, accepted: 1, batch: "LEGACY", expiry: "2029-01-01", status: "Awaiting put away", grn: "GRN-LEGACY", note: "", warehouse: "WH-NORTH", receivingLocation: "RECEIVING" };
  s.receipts.push(legacy);
  s = run(s, {
    type: "receiveReconciliation", warehouse: "WH-NORTH",
    lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "NO-SUPPLIER", expiry: "2029-01-01", received: 2, damaged: 0 }]),
  });
  assert.equal(s.receipts.at(-1).supplier, "Unspecified");
  s = run(s, {
    type: "receiveReconciliation", supplier: "SUP-01", warehouse: "WH-NORTH",
    lines: JSON.stringify([{ product: "WH-2401-BLK", barcode: "89010001", batch: "EXPLICIT-SUPPLIER", expiry: "2029-01-01", received: 2, damaged: 0 }]),
  });
  assert.equal(s.receipts.at(-1).supplier, "SUP-01");
  assert.equal(s.receipts.find((receipt) => receipt.id === legacy.id).supplier, "SUP-01");
  s = run(s, { type: "purchaseOrder", action: "create", id: "PO-SUPPLIER-TEST", supplier: "SUP-01", product: "WH-2401-BLK", qty: 1 });
  s = run(s, { type: "purchaseOrder", action: "send", id: "PO-SUPPLIER-TEST" });
  s = run(s, { type: "purchaseOrder", action: "receive", id: "PO-SUPPLIER-TEST", warehouse: "WH-NORTH", qty: 1, quality: "Passed", batch: "PO-SUPPLIER-BATCH", expiry: "2029-01-01" });
  assert.equal(s.receipts.at(-1).supplier, "SUP-01");
});

test("product defaults validate, remain optional, and scanner commits only valid drafts", () => {
  let s = initial();
  s = run(s, {
    type: "updateMaster", entity: "Product", id: "WH-2401-BLK",
    name: "Headphones", category: "Audio", barcode: "WH2401",
    minimum: 1, price: 10, promotion: "",
    defaultManufacturingDate: "2026-11-01", defaultExpiry: "2027-11-01",
  });
  assert.equal(s.products.find((p) => p.id === "WH-2401-BLK").defaultExpiry, "2027-11-01");
  assert.throws(() => run(s, {
    type: "updateMaster", entity: "Product", id: "WH-2401-BLK",
    name: "Headphones", category: "Audio", barcode: "WH2401", minimum: 1, price: 10,
    defaultManufacturingDate: "2026-11-01", defaultExpiry: "2026-10-01",
  }), /on or before/);
  assert.throws(() => run(s, {
    type: "updateMaster", entity: "Product", id: "WH-2401-BLK",
    name: "Headphones", category: "Audio", barcode: "WH2401", minimum: 1, price: 10,
    defaultManufacturingDate: "2026-11-24", defaultExpiry: "2027-01-01",
  }), /future/);
  const noDefaults = s.products.find((p) => p.id === "WH-2401-BLK");
  assert.ok(noDefaults);
  assert.equal(seed().products.some((p) => p.defaultExpiry !== undefined), false);
  let buffer = { text: "", lastAt: null, fast: true };
  for (const [i, key] of [..."WH2401", "Enter"].entries()) {
    const result = scannerKey(buffer, key, i * 10);
    buffer = result.buffer;
    if (key === "Enter") assert.equal(result.barcode, "WH2401");
  }
  assert.throws(() => commitReceivingDraft([], {
    product: "WH-2401-BLK", barcode: "WH2401", batch: "B-1", manufacturingDate: "",
    expiry: "", received: 1, damaged: 0, warehouse: "WH-NORTH",
  }), /required/);
  const lines = commitReceivingDraft([], {
    product: "WH-2401-BLK", barcode: "WH2401", batch: "B-1", manufacturingDate: "2026-11-01",
    expiry: "2027-11-01", received: 3, damaged: 1, warehouse: "WH-NORTH",
  });
  assert.equal(lines[0].accepted, 2);
});

test("receiving scanner thresholds and warehouse-keyed drafts are safe", () => {
  let buffer = { text: "", lastAt: null, fast: true };
  for (const [i, key] of [..."ABCD", "Enter"].entries()) buffer = scannerKey(buffer, key, i * 5).buffer;
  const scan = scannerKey({ text: "ABCD", lastAt: 15, fast: true }, "Enter", 20);
  assert.equal(scan.barcode, "ABCD");
  const slow = scannerKey({ text: "ABC", lastAt: 0, fast: true }, "D", 500);
  assert.equal(scannerKey(slow.buffer, "Enter", 510).barcode, undefined);
  const storage = { data: new Map(), getItem(k) { return this.data.get(k) ?? null; }, setItem(k, v) { this.data.set(k, v); }, removeItem(k) { this.data.delete(k); } };
  const line = { product: "P", barcode: "B", batch: "LOT", manufacturingDate: "2026-01-01", expiry: "2027-01-01", received: 2, damaged: 0, accepted: 2, warehouse: "A" };
  assert.equal(writeReceivingDraft(storage, "A", [line]), true);
  assert.equal(readReceivingDraft(storage, "B", () => true).lines.length, 0);
  const restored = readReceivingDraft(storage, "A", (value) => Boolean(value && typeof value === "object" && value.product));
  assert.equal(restored.lines.length, 1);
  storage.setItem("stockroom.receiving.draft.A", JSON.stringify({ version: 0, warehouse: "A", lines: [line] }));
  assert.equal(readReceivingDraft(storage, "A", () => true).rejected, true);
  storage.setItem("stockroom.receiving.draft.A", JSON.stringify({ version: 1, warehouse: "A", lines: [line, null] }));
  assert.equal(readReceivingDraft(storage, "A", (value) => Boolean(value && typeof value === "object" && value.product)).dropped, 1);
  clearReceivingDraft(storage, "A");
  assert.equal(readReceivingDraft(storage, "A", () => true).lines.length, 0);
});

test("Receiving render has one scoped list and conditional tab structure", () => {
  const source = fs.readFileSync(new URL("../components/warehouse-dashboard.tsx", import.meta.url), "utf8");
  const receiving = source.slice(source.indexOf('else if (active === "Receiving")'), source.indexOf('else if (active === "Warehouse")'));
  assert.equal((receiving.match(/aria-label="Receiving warehouse"/g) || []).length, 1);
  assert.equal((receiving.match(/title="Receiving list"/g) || []).length, 1);
  assert.equal((receiving.match(/>Confirm receiving</g) || []).length, 1);
  assert.equal((receiving.match(/title="Barcode Scan"/g) || []).length, 1);
  assert.equal((receiving.match(/title="Manual Enter Product"/g) || []).length, 1);
  assert.match(receiving, /receivingMode === "scan"/);
  assert.match(receiving, /receivingMode === "manual"/);
  assert.doesNotMatch(receiving, /Barcode Reconciliation|Warehouse scope|Supplier:|<label>Supplier/);
});

test("Receiving has automatic batches and preserves the legacy scan path", () => {
  const source = fs.readFileSync(new URL("../components/warehouse-dashboard.tsx", import.meta.url), "utf8");
  const receiving = source.slice(source.indexOf('else if (active === "Receiving")'), source.indexOf('else if (active === "Warehouse")'));
  assert.doesNotMatch(receiving, /NEW-BATCH/);
  assert.match(receiving, /Production date/);
  assert.match(receiving, /Expiry date/);
  assert.doesNotMatch(receiving, /New batch|Batch is required|Select an existing batch/);
  assert.match(receiving, /line\.batch \|\| "Auto"/);
  const wms = fs.readFileSync(new URL("../lib/wms.ts", import.meta.url), "utf8");
  assert.match(wms, /case "receiveScan"/);
});

test("automatic receiving batches reuse matching expiry and suffix different expiries in line order", () => {
  let s = initial();
  const base = `WH-NORTH-${receivingDate().slice(2).replace(/-/g, "")}`;
  s = run(s, { type: "receiveReconciliation", warehouse: "WH-NORTH", lines: JSON.stringify([
    { product: "WH-2401-BLK", barcode: "89010001", expiry: "2029-01-01", received: 1, damaged: 0 },
    { product: "WH-2401-BLK", barcode: "89010001", expiry: "2029-01-01", received: 2, damaged: 0 },
    { product: "WH-2401-BLK", barcode: "89010001", expiry: "2030-01-01", received: 3, damaged: 0 },
    { product: "WH-2401-BLK", barcode: "89010001", expiry: "2031-01-01", received: 4, damaged: 0 },
  ]) });
  const receipts = s.receipts.slice(-4);
  assert.deepEqual(receipts.map((receipt) => receipt.batch), [base, base, `${base}-2`, `${base}-3`]);
  assert.equal(new Set(receipts.slice(0, 2).map((receipt) => receipt.id)).size, 2);
});

test("automatic batches are warehouse-scoped, explicit overrides remain validated, and local dates cross midnight correctly", () => {
  let s = initial();
  const baseNorth = `WH-NORTH-${receivingDate().slice(2).replace(/-/g, "")}`;
  const baseSouth = `WH-SOUTH-${receivingDate().slice(2).replace(/-/g, "")}`;
  s = run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-NORTH", product: "WH-2401-BLK", expected: 1, received: 1, damaged: 0, quality: "Passed", expiry: "2029-01-01" });
  s = run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-SOUTH", product: "WH-2401-BLK", expected: 1, received: 1, damaged: 0, quality: "Passed", expiry: "2029-01-01" });
  assert.equal(s.receipts.at(-2).batch, baseNorth);
  assert.equal(s.receipts.at(-1).batch, baseSouth);
  s = run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-NORTH", product: "WH-2401-BLK", expected: 1, received: 1, damaged: 0, quality: "Passed", batch: "SUPPLIER-BATCH", expiry: "2029-01-01" });
  assert.equal(s.receipts.at(-1).batch, "SUPPLIER-BATCH");
  assert.throws(() => run(s, { type: "receive", supplier: "SUP-01", warehouse: "WH-NORTH", product: "WH-2401-BLK", expected: 1, received: 1, damaged: 0, quality: "Passed", batch: "SUPPLIER-BATCH", expiry: "2030-01-01" }), /SUPPLIER-BATCH already exists in WH-NORTH/);
  assert.equal(receivingDate(new Date("2026-11-23T18:29:59.000Z")), "2026-11-23");
  assert.equal(receivingDate(new Date("2026-11-23T18:30:00.000Z")), "2026-11-24");
});

test("receiving list row validation recalculates accepted and blocks invalid edits", () => {
  const line = { product: "P", barcode: "B", batch: "LOT", manufacturingDate: "2026-11-01", expiry: "2026-12-01", received: 10, damaged: 2, accepted: 8, warehouse: "WH" };
  assert.equal(validateReceivingLine({ ...line, received: 12, accepted: 10 }, "2026-11-23"), "");
  assert.equal(Math.max(0, 12 - 2), 10);
  assert.match(validateReceivingLine({ ...line, received: 2, damaged: 3 }, "2026-11-23"), /cannot exceed/);
  assert.match(validateReceivingLine({ ...line, received: 0 }, "2026-11-23"), /positive whole/);
  assert.match(validateReceivingLine({ ...line, expiry: "2026-11-22" }, "2026-11-23"), /today or later/);
  assert.match(validateReceivingLine({ ...line, manufacturingDate: "2026-12-02" }, "2026-11-23"), /on or before/);
  assert.match(validateReceivingLine({ ...line, manufacturingDate: "2026-11-24" }, "2026-11-23"), /future/);
  const source = fs.readFileSync(new URL("../components/warehouse-dashboard.tsx", import.meta.url), "utf8");
  const receiving = source.slice(source.indexOf('else if (active === "Receiving")'), source.indexOf('else if (active === "Warehouse")'));
  assert.match(receiving, /Pending received/);
  assert.match(receiving, /Pending damaged/);
  assert.match(receiving, /Pending production date/);
  assert.match(receiving, /Pending expiry/);
  assert.match(receiving, /validateReceivingLine/);
});

test("capacity totals exclude quarantine capacity and report quarantine units separately", () => {
  const state = {
    locations: [
      { id: "A", warehouse: "W", capacity: 100, kind: "Storage", zone: "A" },
      { id: "Q", warehouse: "W", capacity: 1000000, kind: "Storage", zone: "QUARANTINE" },
    ],
    lots: [
      { id: "L1", product: "P", batch: "B", expiry: "2029-01-01", location: "A", qty: 7, reserved: 0 },
      { id: "L2", product: "P", batch: "Q", expiry: "2020-01-01", location: "Q", qty: 3, reserved: 0 },
    ],
  };
  const totals = warehouseStorageTotals(state, "W");
  assert.deepEqual(totals, { capacity: 100, occupied: 7, available: 93, excess: 0, quarantine: 3 });
  const occupancy = storageOccupancy(state);
  assert.deepEqual(occupancy.group("W"), { capacity: 100, occupied: 7, available: 93, excess: 0 });
  assert.equal(occupancy.unit("Q").capacity, 0);
  const source = fs.readFileSync(new URL("../components/warehouse-dashboard.tsx", import.meta.url), "utf8");
  const map = fs.readFileSync(new URL("../components/warehouse-space-map.tsx", import.meta.url), "utf8");
  assert.match(source, /warehouseStorageTotals\(s, warehouseScope\)/);
  assert.match(map, /warehouseStorageTotals\(state, warehouse\)/);
});
