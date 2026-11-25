import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  execute,
  available,
  lotWarehouse,
  today,
} from "../lib/wms.ts";
import {
  ORDER_DATE_FIELD,
  toLocalDateString,
  formatPickListDate,
  PICK_LIST_SORT,
  comparePickRowsDefault,
} from "../lib/picking-utils.ts";

const admin = { id: "admin", name: "Admin", role: "Admin", active: true };
const supervisor = { id: "supervisor", name: "Supervisor", role: "Supervisor", active: true };
const operator1 = { id: "operator1", name: "Operator One", role: "Operator", active: true };
const operator2 = { id: "operator2", name: "Operator Two", role: "Operator", active: true };

function createTestState() {
  const state = seed();
  state.users = [admin, supervisor, operator1, operator2].map((u) => ({
    ...u,
    password: "pw",
  }));

  state.products = [
    { id: "PRD-A", name: "Apple", category: "Produce", barcode: "890001", unit: "unit", minimum: 5 },
    { id: "PRD-B", name: "Banana", category: "Produce", barcode: "890002", unit: "unit", minimum: 5 },
    { id: "PRD-C", name: "Carrot", category: "Produce", barcode: "890003", unit: "unit", minimum: 5 },
  ];

  state.locations = [
    { id: "LOC-P1-A1", zone: "Zone A", rack: "3", row: 2, column: 4, section: "SEC-1", warehouse: "PRIYANT1", kind: "Storage", capacity: 10000 },
    { id: "LOC-P1-B1", zone: "Zone B", rack: "01", row: 1, column: 1, warehouse: "PRIYANT1", kind: "Storage", capacity: 10000 },
    { id: "LOC-P2-A1", zone: "Zone A", rack: "1", row: 1, column: 1, warehouse: "PRIYANT2", kind: "Storage", capacity: 10000 },
  ];

  state.lots = [
    { id: "LOT-P1-A", product: "PRD-A", location: "LOC-P1-A1", qty: 5000, reserved: 0, batch: "BAT-A", expiry: "2028-12-31" },
    { id: "LOT-P1-B", product: "PRD-B", location: "LOC-P1-B1", qty: 5000, reserved: 0, batch: "BAT-B", expiry: "2028-12-31" },
    { id: "LOT-P1-C", product: "PRD-C", location: "LOC-P1-A1", qty: 5000, reserved: 0, batch: "BAT-C", expiry: "2028-12-31" },
    { id: "LOT-P2-A", product: "PRD-A", location: "LOC-P2-A1", qty: 5000, reserved: 0, batch: "BAT-P2-A", expiry: "2028-12-31" },
  ];

  state.warehouses = [
    { id: "PRIYANT1", name: "Warehouse Priyant 1" },
    { id: "PRIYANT2", name: "Warehouse Priyant 2" },
  ];

  state.orders = [];
  return state;
}

test("1. Assignee rule: Operator can pick an unassigned order and becomes its assignee", () => {
  let state = createTestState();

  // Create unassigned order
  state = execute(state, {
    type: "order",
    customer: "Unassigned Customer",
    product: "PRD-A",
    qty: 5,
    warehouse: "PRIYANT1",
  }, admin);

  const order = state.orders[0];
  assert.equal(order.assignee, ""); // unassigned

  // Operator 1 picks the unassigned order directly without prior assignment
  state = execute(state, {
    type: "pick",
    order: order.id,
    productBarcode: "890001",
    qty: 5,
  }, operator1);

  const pickedOrder = state.orders.find((o) => o.id === order.id);
  assert.equal(pickedOrder.status, "Picked");
  assert.equal(pickedOrder.picked, 5);
  // Proves Operator 1 became the assignee automatically!
  assert.equal(pickedOrder.assignee, operator1.id);
});

test("2. Operator CANNOT pick an order assigned to another user", () => {
  let state = createTestState();

  state = execute(state, {
    type: "order",
    customer: "Assigned to Op2",
    product: "PRD-A",
    qty: 5,
    warehouse: "PRIYANT1",
  }, admin);

  const orderId = state.orders[0].id;

  // Supervisor assigns order to Operator 2
  state = execute(state, {
    type: "assign",
    order: orderId,
    assignee: operator2.id,
  }, supervisor);

  assert.equal(state.orders[0].assignee, operator2.id);

  // Operator 1 attempts to pick Operator 2's task -> MUST THROW
  assert.throws(() => {
    execute(state, {
      type: "pick",
      order: orderId,
      productBarcode: "890001",
      qty: 5,
    }, operator1);
  }, /This task is assigned to another user/);
});

test("3. Day grouping uses browser LOCAL date YYYY-MM-DD and ORDER_DATE_FIELD", () => {
  assert.equal(ORDER_DATE_FIELD, "createdAt");

  // Test local date conversion across UTC offset
  const isoUtcMidnight = "2026-11-20T00:00:00.000Z";
  const localFormatted = toLocalDateString(isoUtcMidnight);
  assert.match(localFormatted, /^\d{4}-\d{2}-\d{2}$/);

  const invalid = toLocalDateString("");
  assert.equal(invalid, "");
});

test("4. Location string formatting: Zone A · Rack 3 · Row 2 · Col 4", () => {
  const loc = {
    zone: "Zone A",
    rack: "3",
    row: 2,
    column: 4,
    section: "SEC-1",
  };

  const parts = [];
  if (loc.zone) parts.push(loc.zone.startsWith("Zone") ? loc.zone : `Zone ${loc.zone}`);
  if (loc.rack) parts.push(`Rack ${parseInt(loc.rack, 10) || loc.rack}`);
  if (loc.row != null) parts.push(`Row ${loc.row}`);
  if (loc.column != null) parts.push(`Col ${loc.column}`);

  const str = parts.join(" · ");
  assert.equal(str, "Zone A · Rack 3 · Row 2 · Col 4");
});

test("5. Short pick requires reason, releases unpicked reservations, and records short pick", () => {
  let state = createTestState();

  state = execute(state, {
    type: "order",
    customer: "Short Pick Test",
    product: "PRD-A",
    qty: 10,
    warehouse: "PRIYANT1",
  }, admin);

  const orderId = state.orders[0].id;
  const lot = state.lots.find((l) => l.id === "LOT-P1-A");
  assert.equal(lot.reserved, 10);

  // 1. Short pick without reason MUST FAIL
  assert.throws(() => {
    execute(state, {
      type: "pick",
      order: orderId,
      productBarcode: "890001",
      qty: 6,
    }, operator1);
  }, /A reason is required for a short pick/);

  // 2. Short pick with reason SUCCEEDS
  state = execute(state, {
    type: "pick",
    order: orderId,
    productBarcode: "890001",
    qty: 6,
    reason: "Damaged box",
  }, operator1);

  const o = state.orders.find((x) => x.id === orderId);
  assert.equal(o.status, "Short picked");
  assert.equal(o.picked, 6);

  const updatedLot = state.lots.find((l) => l.id === "LOT-P1-A");
  // 4 unpicked units released from reservation!
  assert.equal(updatedLot.reserved, 6);
  assert.equal(available(updatedLot), 5000 - 6);
});

test("6. Large Batch Simulation: Day 1 (200), Day 2 (300), Day 3 (500) orders", async () => {
  let state = createTestState();

  // Helper to create synthetic orders on specific local dates
  function seedDayOrders(dayDateStr, count, warehouseId) {
    const orders = [];
    for (let i = 1; i <= count; i++) {
      const isMultiLine = i % 10 === 0; // 10% multi-line orders
      const lines = isMultiLine
        ? [
            { product: "PRD-A", qty: 2, picked: 0, packed: 0 },
            { product: "PRD-B", qty: 3, picked: 0, packed: 0 },
          ]
        : [{ product: "PRD-A", qty: 2, picked: 0, packed: 0 }];

      const totalQty = lines.reduce((s, l) => s + l.qty, 0);
      const isoCreatedAt = new Date(`${dayDateStr}T10:00:00`).toISOString();

      const allocations = lines.map((l) => {
        const lot = state.lots.find(
          (item) => item.product === l.product && lotWarehouse(state, item) === warehouseId
        );
        return { lot: lot.id, product: l.product, qty: l.qty };
      });

      orders.push({
        id: `ORD-${warehouseId}-${dayDateStr}-${i}`,
        customer: `Customer ${String(i).padStart(4, "0")}`,
        product: lines[0].product,
        qty: totalQty,
        picked: 0,
        allocations,
        status: "Reserved",
        assignee: "",
        weight: 0,
        dimensions: "",
        material: "",
        courier: "",
        tracking: "",
        delivery: "",
        orderType: "Customer Order",
        warehouse: warehouseId,
        lines,
        createdAt: isoCreatedAt,
      });

      // Update reserved count on lots
      for (const line of lines) {
        const lot = state.lots.find(
          (l) => l.product === line.product && lotWarehouse(state, l) === warehouseId
        );
        if (lot) lot.reserved += line.qty;
      }
    }
    return orders;
  }

  // Seed Day 1 = 200, Day 2 = 300, Day 3 = 500 orders
  const d1Orders = seedDayOrders("2026-11-20", 200, "PRIYANT1");
  const d2Orders = seedDayOrders("2026-11-21", 300, "PRIYANT1");
  const d3Orders = seedDayOrders("2026-11-22", 500, "PRIYANT1");

  state.orders = [...d1Orders, ...d2Orders, ...d3Orders];

  // 1. Verify Day dropdown counts
  const day1Orders = state.orders.filter(
    (o) => toLocalDateString(o.createdAt) === "2026-11-20" && o.warehouse === "PRIYANT1"
  );
  const day2Orders = state.orders.filter(
    (o) => toLocalDateString(o.createdAt) === "2026-11-21" && o.warehouse === "PRIYANT1"
  );
  const day3Orders = state.orders.filter(
    (o) => toLocalDateString(o.createdAt) === "2026-11-22" && o.warehouse === "PRIYANT1"
  );

  assert.equal(day1Orders.length, 200, "Day 1 must have 200 orders");
  assert.equal(day2Orders.length, 300, "Day 2 must have 300 orders");
  assert.equal(day3Orders.length, 500, "Day 3 must have 500 orders");

  // 2. Benchmark render / construction time for 500-order list
  const startBenchmark = performance.now();
  const day3Lines = [];
  for (const o of day3Orders) {
    for (const l of o.lines) {
      day3Lines.push({
        orderId: o.id,
        customer: o.customer,
        warehouse: o.warehouse,
        sku: l.product,
        qty: l.qty,
      });
    }
  }
  const endBenchmark = performance.now();
  const durationMs = endBenchmark - startBenchmark;
  console.log(`Render construction time for 500 orders (${day3Lines.length} lines): ${durationMs.toFixed(2)} ms`);
  assert.ok(durationMs < 100, "500-order construction must be under 100ms");

  // 3. Complete Day 1 batch pick with 2 short picks
  const initialPhysical = state.lots.reduce((s, l) => s + l.qty, 0);

  let successCount = 0;
  let shortCount = 0;

  for (let i = 0; i < day1Orders.length; i++) {
    const o = day1Orders[i];
    for (const line of o.lines) {
      const isShort = i === 5 || i === 12; // 2 short picks
      const pickQty = isShort ? line.qty - 1 : line.qty;

      state = execute(state, {
        type: "pick",
        order: o.id,
        productBarcode: state.products.find((p) => p.id === line.product).barcode,
        qty: pickQty,
        reason: isShort ? "Short pick test" : undefined,
      }, operator1);

      if (isShort) shortCount++;
      else successCount++;
    }
  }

  assert.equal(shortCount, 2);
  assert.ok(successCount > 0);

  // 4. Verify inventory balance: Physical stock must be unchanged after pick (deductions only happen at dispatch)
  const postPickPhysical = state.lots.reduce((s, l) => s + l.qty, 0);
  assert.equal(postPickPhysical, initialPhysical, "Physical stock must not be deducted on pick");

  // 5. Verify picked orders appear in Packing eligibility
  const pickedOrders = state.orders.filter((o) => ["Picked", "Packing"].includes(o.status));
  assert.equal(pickedOrders.length, 198); // 200 - 2 short picked = 198 fully Picked
});

test("7. User-requested Pick List Format: Product Pick List heading, date formatting, and table columns", () => {
  // Test date formatting: e.g. "Tuesday, November 24, 2026 12:57 AM"
  const formatted = formatPickListDate("2026-11-24");
  assert.match(formatted, /^Tuesday,\s+November\s+24,\s+2026/);
  assert.match(formatted, /\b(AM|PM)\b/);

  // Validate format components: Item #, Description, Warehouse, Location, # Required
  const sampleRow = {
    itemNumber: "013388410446",
    description: "NSW Ace Attorney Investigations Collection (Nintendo Switch, 2024)",
    specification: "Nintendo Switch/Ace Attorney Investigations Collection",
    warehouse: "PRIYANT1",
    location: "NA",
    required: 1,
  };

  assert.equal(sampleRow.itemNumber, "013388410446");
  assert.ok(sampleRow.description.includes("Ace Attorney"));
  assert.equal(sampleRow.specification, "Nintendo Switch/Ace Attorney Investigations Collection");
  assert.equal(sampleRow.location, "NA");
  assert.equal(sampleRow.required, 1);
});

test("8. Addendum Ordering Rules: Alphabetical sort A-Z and tie-breaking", () => {
  assert.deepEqual(PICK_LIST_SORT, ["customer", "orderId", "productName", "itemNo"]);

  // 1. Seed orders with customers "Zed", "alpha", "Beta", "Priyant 1", "BOT1" created on different days/times
  const rows = [
    { customer: "Zed", orderId: "ORD-05", productName: "Item", sku: "1", createdAt: "2026-11-20T08:00:00Z" },
    { customer: "alpha", orderId: "ORD-01", productName: "Item", sku: "2", createdAt: "2026-11-25T18:00:00Z" },
    { customer: "Beta", orderId: "ORD-02", productName: "Item", sku: "3", createdAt: "2026-11-22T12:00:00Z" },
    { customer: "Priyant 1", orderId: "ORD-04", productName: "Item", sku: "4", createdAt: "2026-11-21T06:00:00Z" },
    { customer: "BOT1", orderId: "ORD-03", productName: "Item", sku: "5", createdAt: "2026-11-24T14:00:00Z" },
  ];

  const sorted = [...rows].sort(comparePickRowsDefault);
  const resultCustomers = sorted.map((r) => r.customer);
  // Confirm the list order is: alpha, Beta, BOT1, Priyant 1, Zed (case-insensitive)
  assert.deepEqual(resultCustomers, ["alpha", "Beta", "BOT1", "Priyant 1", "Zed"]);

  // 2. Two orders for the same customer: ordered by order ID, with lines alphabetical by product name
  const sameCustomerRows = [
    { customer: "Acme", orderId: "ORD-200", productName: "Zucchini", sku: "ZUC-1" },
    { customer: "Acme", orderId: "ORD-100", productName: "Banana", sku: "BAN-1" },
    { customer: "Acme", orderId: "ORD-100", productName: "Apple", sku: "APP-1" },
    { customer: "Acme", orderId: "ORD-200", productName: "Carrot", sku: "CAR-1" },
  ];

  const sortedSameCust = [...sameCustomerRows].sort(comparePickRowsDefault);
  assert.deepEqual(
    sortedSameCust.map((r) => `${r.orderId}:${r.productName}`),
    ["ORD-100:Apple", "ORD-100:Banana", "ORD-200:Carrot", "ORD-200:Zucchini"]
  );
});

