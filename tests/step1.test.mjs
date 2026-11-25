import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, execute } from "../lib/wms.ts";

const staffA = { id: "alice", name: "Alice Adams", role: "Operator" };
const staffB = { id: "bob", name: "Bob Builder", role: "Supervisor" };

function getInitialState() {
  const s = seed();
  s.users = [
    { ...staffA, password: "", active: true },
    { ...staffB, password: "", active: true },
  ];
  return s;
}

test("Step 1: Different-staff rule - Receiving scanner cannot be verifier", () => {
  let s = getInitialState();
  // Start session
  s = execute(s, {
    type: "receiveScan",
    action: "start",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    receivingLocation: "RECEIVING",
    expected: JSON.stringify([{ product: "WH-2401-BLK", qty: 5 }]),
  }, staffA);

  const sessionId = s.receivingSessions.at(-1).id;

  // Alice scans
  s = execute(s, {
    type: "receiveScan",
    action: "scan",
    session: sessionId,
    barcode: "89010001",
    qty: 5,
  }, staffA);

  assert.equal(s.receivingSessions.find(x => x.id === sessionId).scannedBy, "Alice Adams");
  assert.ok(s.receivingSessions.find(x => x.id === sessionId).scannedAt);

  // Alice tries to verify -> MUST BLOCK
  assert.throws(
    () => execute(s, {
      type: "receiveScan",
      action: "verify",
      session: sessionId,
    }, staffA),
    /Receiving scanner and verifier must be different staff members/
  );

  // Bob (different staff) verifies -> MUST SUCCEED
  s = execute(s, {
    type: "receiveScan",
    action: "verify",
    session: sessionId,
  }, staffB);

  const sessionAfterVerify = s.receivingSessions.find(x => x.id === sessionId);
  assert.equal(sessionAfterVerify.verifiedBy, "Bob Builder");
  assert.ok(sessionAfterVerify.verifiedAt);
});

test("Step 1: Different-staff rule - Transfer requester cannot be approver", () => {
  let s = getInitialState();
  s.storeStock = [{ store: "STORE-01", product: "WH-2401-BLK", qty: 20 }];

  // Alice requests transfer
  s = execute(s, {
    type: "transfer",
    action: "create",
    source: "STORE-01",
    destination: "STORE-02",
    lines: JSON.stringify([{ product: "WH-2401-BLK", qty: 5 }]),
  }, staffA);

  const transfer = s.transfers.at(-1);
  assert.equal(transfer.requestedBy, "Alice Adams");
  assert.ok(transfer.requestedAt);

  // Alice tries to approve her own transfer -> MUST BLOCK
  assert.throws(
    () => execute(s, {
      type: "transfer",
      action: "approve",
      transfer: transfer.id,
    }, staffA),
    /Transfer requester and approver must be different staff members/
  );

  // Bob (different staff) approves -> MUST SUCCEED
  s = execute(s, {
    type: "transfer",
    action: "approve",
    transfer: transfer.id,
  }, staffB);

  const approvedTransfer = s.transfers.find(x => x.id === transfer.id);
  assert.equal(approvedTransfer.status, "Approved");
  assert.equal(approvedTransfer.approvedBy, "Bob Builder");
  assert.ok(approvedTransfer.approvedAt);
});

test("Step 1: Staff name and timestamp recorded on every operation (order, pick, pack, dispatch, putaway, transfer)", () => {
  let s = getInitialState();

  // 1. Order
  s = execute(s, {
    type: "order",
    customer: "Test Customer",
    product: "WH-2401-BLK",
    qty: 2,
    warehouse: "WH-NORTH",
  }, staffA);

  const order = s.orders.at(-1);
  assert.equal(order.createdBy, "Alice Adams");
  assert.ok(order.createdAt);
  assert.equal(s.events[0].actor, "Alice Adams");

  // Assign to Alice so operator Alice can pick
  s = execute(s, { type: "assign", order: order.id, assignee: "alice" }, staffB);

  // 2. Pick
  s = execute(s, {
    type: "pick",
    order: order.id,
    productBarcode: "89010001",
    qty: 2,
  }, staffA);

  const pickedOrder = s.orders.find(o => o.id === order.id);
  assert.equal(pickedOrder.pickedBy, "Alice Adams");
  assert.ok(pickedOrder.pickedAt);
  assert.equal(s.events[0].actor, "Alice Adams");

  // 3. Pack
  s = execute(s, {
    type: "pack",
    order: order.id,
    productBarcode: "89010001",
    qty: 2,
    weight: 1.5,
    dimensions: "10x10x10",
    material: "Carton",
  }, staffB);

  const packedOrder = s.orders.find(o => o.id === order.id);
  assert.equal(packedOrder.packedBy, "Bob Builder");
  assert.ok(packedOrder.packedAt);
  assert.equal(s.events[0].actor, "Bob Builder");

  // 4. Dispatch
  s = execute(s, {
    type: "dispatch",
    order: order.id,
    qty: 2,
    courier: "Express Delivery",
    tracking: "TRK-12345",
  }, staffA);

  const dispatchedOrder = s.orders.find(o => o.id === order.id);
  assert.equal(dispatchedOrder.dispatchedBy, "Alice Adams");
  assert.ok(dispatchedOrder.dispatchedAt);
  assert.equal(s.events[0].actor, "Alice Adams");

  // 5. Put-away
  // First seed a receiving lot
  s.lots.push({
    id: "LOT-TEST-PUTAWAY",
    product: "WH-2401-BLK",
    batch: "BATCH-PA",
    expiry: "2030-01-01",
    location: "RECEIVING",
    qty: 10,
    reserved: 0,
  });

  s = execute(s, {
    type: "putaway",
    lot: "LOT-TEST-PUTAWAY",
    destination: "A-01",
    qty: 10,
    productBarcode: "89010001",
    locationBarcode: "A-01",
  }, staffB);

  const putawayLot = s.lots.find(l => l.batch === "BATCH-PA" && l.location === "A-01");
  assert.equal(putawayLot.putAwayBy, "Bob Builder");
  assert.ok(putawayLot.putAwayAt);
  assert.equal(s.events[0].actor, "Bob Builder");

  // 6. Transfer dispatch and receive
  s.storeStock = [{ store: "STORE-01", product: "WH-2401-BLK", qty: 20 }];
  s = execute(s, {
    type: "transfer",
    action: "create",
    source: "STORE-01",
    destination: "STORE-02",
    lines: JSON.stringify([{ product: "WH-2401-BLK", qty: 4 }]),
  }, staffA);

  const trf = s.transfers.at(-1);
  s = execute(s, {
    type: "transfer",
    action: "approve",
    transfer: trf.id,
  }, staffB);
  s = execute(s, {
    type: "transfer",
    action: "dispatch",
    transfer: trf.id,
  }, staffA);
  assert.equal(s.transfers.find(x => x.id === trf.id).dispatchedBy, "Alice Adams");
  assert.ok(s.transfers.find(x => x.id === trf.id).dispatchedAt);

  s = execute(s, {
    type: "transfer",
    action: "receive",
    transfer: trf.id,
    received: JSON.stringify([{ product: "WH-2401-BLK", qty: 4 }]),
  }, staffB);
  assert.equal(s.transfers.find(x => x.id === trf.id).receivedBy, "Bob Builder");
  assert.ok(s.transfers.find(x => x.id === trf.id).receivedAt);
});
