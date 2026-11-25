import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, execute, available } from "../lib/wms.ts";

const admin = { id: "admin", name: "Admin", role: "Admin" };
const operator = { id: "operator", name: "Picker", role: "Operator" };

function stateWithStaff() {
  const state = seed();
  state.users = [admin, operator].map((user) => ({ ...user, password: "unused", active: true }));
  return state;
}

test("complete flow: receiving to put-away to reservation, picking, packing and dispatch", () => {
  let state = stateWithStaff();
  const beforePhysical = state.lots.reduce((sum, lot) => sum + lot.qty, 0);

  state = execute(state, {
    type: "receive",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    product: "WH-2401-BLK",
    expected: 25,
    received: 25,
    damaged: 2,
    rejected: 1,
    quality: "Passed",
    status: "Accepted",
    batch: "FLOW-TEST-01",
    expiry: "2027-12-31",
    note: "Integration flow test",
  }, admin);
  const receipt = state.receipts.at(-1);
  assert.equal(receipt.accepted, 22);
  assert.equal(receipt.status, "Awaiting put away");
  const receivingLot = state.lots.find((lot) => lot.receiptId === receipt.id);
  assert.equal(receivingLot.qty, 22);
  assert.equal(available(receivingLot), 0);

  state = execute(state, {
    type: "putaway",
    lot: receivingLot.id,
    destination: "A-01",
    qty: 22,
    productBarcode: "89010001",
    locationBarcode: "A-01",
  }, admin);
  assert.equal(state.lots.find((lot) => lot.id === receivingLot.id).qty, 0);
  const placedLotId = state.lots.at(-1).id;
  const placedLot = state.lots.find((lot) => lot.id === placedLotId);
  assert.equal(placedLot.location, "A-01");
  assert.equal(placedLot.qty, 22);
  assert.equal(available(placedLot), 22);

  state = execute(state, {
    type: "order",
    customer: "Integration test customer",
    product: "WH-2401-BLK",
    qty: 10,
    warehouse: "WH-NORTH",
  }, admin);
  const order = state.orders.at(-1);
  const currentPlacedLot = state.lots.find((lot) => lot.id === placedLotId);
  assert.equal(order.status, "Reserved");
  assert.equal(available(currentPlacedLot), 12);

  state = execute(state, { type: "assign", order: order.id, assignee: "operator" }, admin);
  state = execute(state, { type: "pick", order: order.id, productBarcode: "89010001", qty: 10 }, operator);
  assert.equal(state.orders.at(-1).status, "Picked");
  state = execute(state, {
    type: "pack",
    order: order.id,
    productBarcode: "89010001",
    qty: 10,
    material: "Carton",
    dimensions: "20x20x10",
    weight: 1.5,
  }, operator);
  assert.equal(state.orders.at(-1).status, "Packed");

  const beforeDispatch = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
  state = execute(state, {
    type: "dispatch",
    order: order.id,
    qty: 10,
    courier: "Test Courier",
    tracking: "FLOW-TRACK-01",
  }, admin);
  assert.equal(state.orders.at(-1).status, "Dispatched");
  assert.equal(state.lots.reduce((sum, lot) => sum + lot.qty, 0), beforeDispatch - 10);
  assert.equal(state.lots.reduce((sum, lot) => sum + lot.qty, 0), beforePhysical + 12);
  assert.equal(state.lots.find((lot) => lot.id === placedLot.id).reserved, 0);
});
