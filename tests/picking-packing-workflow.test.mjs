import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  execute,
  available,
  lotWarehouse,
  today,
} from "../lib/wms.ts";

const admin = { id: "admin", name: "Admin", role: "Admin" };
const operator = { id: "operator", name: "Warehouse Staff", role: "Operator" };

// Pure sorting function matching components/picking-packing-workflow.tsx
function sortOrders(
  orders,
  productMap,
  { sortCriterion, dateDirection, productDirection, combinedPriority }
) {
  return [...orders].sort((a, b) => {
    const dateA = a.createdAt || "";
    const dateB = b.createdAt || "";
    let dateCmp = dateA.localeCompare(dateB);
    if (dateDirection === "desc") dateCmp = -dateCmp;

    const prodIdA = a.lines?.[0]?.product || a.product || "";
    const prodIdB = b.lines?.[0]?.product || b.product || "";
    const nameA = productMap.get(prodIdA)?.name || prodIdA;
    const nameB = productMap.get(prodIdB)?.name || prodIdB;
    let prodCmp = nameA.localeCompare(nameB, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (productDirection === "desc") prodCmp = -prodCmp;

    if (sortCriterion === "date") return dateCmp;
    if (sortCriterion === "product") return prodCmp;

    if (combinedPriority === "date-first") {
      return dateCmp !== 0 ? dateCmp : prodCmp;
    } else {
      return prodCmp !== 0 ? prodCmp : dateCmp;
    }
  });
}

// Pure consolidation function matching components/picking-packing-workflow.tsx
function buildConsolidatedList(orders, state, selectedOrderIds, warehouseScope = "ALL") {
  const eligibleOrders = orders.filter(
    (o) =>
      ["Reserved", "Picking"].includes(o.status) &&
      !["Cancelled", "Dispatched", "Packed"].includes(o.status) &&
      (warehouseScope === "ALL" ||
        (o.warehouse
          ? o.warehouse === warehouseScope
          : o.allocations.some((a) => {
              const lot = state.lots.find((l) => l.id === a.lot);
              return lot && lotWarehouse(state, lot) === warehouseScope;
            })))
  );

  const selectedOrders = eligibleOrders.filter((o) =>
    selectedOrderIds.has(o.id)
  );

  const productMap = new Map(state.products.map((p) => [p.id, p]));
  const skuMap = new Map();

  for (const order of selectedOrders) {
    const orderDate = order.createdAt || "";
    const lines = order.lines?.length
      ? order.lines
      : [{ product: order.product, qty: order.qty, picked: order.picked || 0, packed: 0 }];

    for (const line of lines) {
      const sku = line.product;
      const prod = productMap.get(sku);
      const prodName = prod?.name || sku;

      let entry = skuMap.get(sku);
      if (!entry) {
        entry = {
          productId: sku,
          sku,
          productName: prodName,
          totalRequired: 0,
          totalPicked: 0,
          contributingOrders: [],
          locationsMap: new Map(),
          earliestOrderDate: orderDate,
        };
        skuMap.set(sku, entry);
      }

      entry.totalRequired += line.qty;
      entry.totalPicked += line.picked || 0;
      if (!entry.earliestOrderDate || (orderDate && orderDate < entry.earliestOrderDate)) {
        entry.earliestOrderDate = orderDate;
      }

      entry.contributingOrders.push({
        orderId: order.id,
        customer: order.customer,
        orderDate,
        requiredQty: line.qty,
        pickedQty: line.picked || 0,
        status: order.status,
      });

      const lineAllocations = (order.allocations || []).filter(
        (a) => a.product === sku
      );

      for (const alloc of lineAllocations) {
        const lot = state.lots.find((l) => l.id === alloc.lot);
        if (!lot) continue;
        const loc = state.locations.find((l) => l.id === lot.location);
        const zone = loc?.zone || "Unassigned";
        const rack = loc?.rack || "";
        const bin = loc ? loc.section || `R${loc.row}C${loc.column}` : lot.location;

        const key = `${lot.id}-${lot.location}`;
        const existingLoc = entry.locationsMap.get(key);
        if (existingLoc) {
          existingLoc.allocatedQty += alloc.qty;
        } else {
          entry.locationsMap.set(key, {
            lotId: lot.id,
            zone,
            rack,
            bin,
            batch: lot.batch,
            expiry: lot.expiry,
            allocatedQty: alloc.qty,
          });
        }
      }
    }
  }

  return Array.from(skuMap.values()).map((item) => ({
    ...item,
    remaining: Math.max(0, item.totalRequired - item.totalPicked),
    locations: Array.from(item.locationsMap.values()),
  }));
}

// Order packing readiness evaluator matching components/picking-packing-workflow.tsx
function getPackingReadiness(order) {
  const lines = order.lines?.length
    ? order.lines
    : [{ product: order.product, qty: order.qty, picked: order.picked || 0, packed: 0 }];

  const isAllPicked = lines.every(
    (l) => (l.picked || 0) === l.qty && l.qty > 0
  );
  const isPartiallyPicked =
    lines.some((l) => (l.picked || 0) > 0) && !isAllPicked;
  const isAllPacked =
    lines.every((l) => (l.packed || 0) === l.qty && l.qty > 0) ||
    order.status === "Packed";

  if (isAllPacked) return "Packed";
  if (isAllPicked) return "Ready to Pack";
  if (isPartiallyPicked) return "Partially Picked";
  return "Awaiting Pick";
}

function createTestState() {
  const state = seed();
  state.users = [admin, operator].map((u) => ({ ...u, password: "pw", active: true }));

  // Add sample products for test
  state.products = [
    { id: "SKU-APPLE-1", name: "Apple Red Delicious", category: "Produce", barcode: "111001", unit: "unit", minimum: 5 },
    { id: "SKU-APPLE-2", name: "Apple Gala", category: "Produce", barcode: "111002", unit: "unit", minimum: 5 },
    { id: "SKU-BANANA", name: "Banana Cavendish", category: "Produce", barcode: "222001", unit: "unit", minimum: 5 },
    { id: "SKU-CHERRY", name: "Cherry Bing", category: "Produce", barcode: "333001", unit: "unit", minimum: 5 },
  ];

  // Locations in PRIYANT1
  state.locations = [
    { id: "P1-LOC-A1", zone: "Zone A", rack: "01", section: "BIN-A01", row: 1, column: 1, warehouse: "PRIYANT1" },
    { id: "P1-LOC-A2", zone: "Zone A", rack: "02", section: "BIN-A02", row: 1, column: 2, warehouse: "PRIYANT1" },
    { id: "P1-LOC-B1", zone: "Zone B", rack: "01", section: "BIN-B01", row: 1, column: 1, warehouse: "PRIYANT1" },
    { id: "P1-LOC-C1", zone: "Zone C", rack: "01", section: "BIN-C01", row: 1, column: 1, warehouse: "PRIYANT1" },
    { id: "P2-LOC-A1", zone: "Zone A", rack: "01", section: "BIN-P2-A01", row: 1, column: 1, warehouse: "PRIYANT2" },
  ];

  // Lots
  state.lots = [
    { id: "LOT-A1", product: "SKU-APPLE-1", location: "P1-LOC-A1", qty: 50, reserved: 0, batch: "BAT-A1", expiry: "2027-12-31" },
    { id: "LOT-A2", product: "SKU-APPLE-2", location: "P1-LOC-A2", qty: 40, reserved: 0, batch: "BAT-A2", expiry: "2027-10-31" },
    { id: "LOT-B1", product: "SKU-BANANA", location: "P1-LOC-B1", qty: 60, reserved: 0, batch: "BAT-B1", expiry: "2027-11-30" },
    { id: "LOT-C1", product: "SKU-CHERRY", location: "P1-LOC-C1", qty: 30, reserved: 0, batch: "BAT-C1", expiry: "2027-08-31" },
    { id: "LOT-P2-A1", product: "SKU-APPLE-1", location: "P2-LOC-A1", qty: 25, reserved: 0, batch: "BAT-P2-A1", expiry: "2027-12-31" },
  ];

  state.warehouses = [
    { id: "PRIYANT1", name: "Warehouse Priyant 1" },
    { id: "PRIYANT2", name: "Warehouse Priyant 2" },
  ];

  state.orders = [];
  return state;
}

test("Scenario 1: Multiple orders containing the same product aggregate correctly", () => {
  let state = createTestState();

  // Create two orders for SKU-APPLE-1
  state = execute(state, {
    type: "order",
    customer: "Alice",
    product: "SKU-APPLE-1",
    qty: 10,
    warehouse: "PRIYANT1",
  }, admin);
  state.orders.at(-1).createdAt = "2026-11-20T10:00:00Z";

  state = execute(state, {
    type: "order",
    customer: "Bob",
    product: "SKU-APPLE-1",
    qty: 15,
    warehouse: "PRIYANT1",
  }, admin);
  state.orders.at(-1).createdAt = "2026-11-21T10:00:00Z";

  const allEligibleIds = new Set(state.orders.map((o) => o.id));
  const consolidated = buildConsolidatedList(state.orders, state, allEligibleIds, "PRIYANT1");

  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].sku, "SKU-APPLE-1");
  assert.equal(consolidated[0].totalRequired, 25);
  assert.equal(consolidated[0].totalPicked, 0);
  assert.equal(consolidated[0].remaining, 25);
  assert.equal(consolidated[0].contributingOrders.length, 2);
  assert.equal(consolidated[0].contributingOrders[0].customer, "Alice");
  assert.equal(consolidated[0].contributingOrders[1].customer, "Bob");
  // Source orders remain distinct
  assert.equal(state.orders.length, 2);
  assert.notEqual(state.orders[0].id, state.orders[1].id);
});

test("Scenario 2: Multi-product order is correctly split into respective SKU buckets", () => {
  let state = createTestState();

  // Create multi-line order with Apples and Bananas
  state = execute(state, {
    type: "order",
    customer: "Charlie",
    warehouse: "PRIYANT1",
    lines: JSON.stringify([
      { product: "SKU-APPLE-1", qty: 8 },
      { product: "SKU-BANANA", qty: 12 },
    ]),
  }, admin);

  const allEligibleIds = new Set(state.orders.map((o) => o.id));
  const consolidated = buildConsolidatedList(state.orders, state, allEligibleIds, "PRIYANT1");

  assert.equal(consolidated.length, 2);
  const appleItem = consolidated.find((c) => c.sku === "SKU-APPLE-1");
  const bananaItem = consolidated.find((c) => c.sku === "SKU-BANANA");

  assert.ok(appleItem);
  assert.ok(bananaItem);
  assert.equal(appleItem.totalRequired, 8);
  assert.equal(bananaItem.totalRequired, 12);
  assert.equal(appleItem.contributingOrders[0].orderId, state.orders[0].id);
  assert.equal(bananaItem.contributingOrders[0].orderId, state.orders[0].id);
});

test("Scenario 3: Different SKUs with similar names remain strictly separate", () => {
  let state = createTestState();

  state = execute(state, {
    type: "order",
    customer: "David",
    product: "SKU-APPLE-1", // Apple Red Delicious
    qty: 5,
    warehouse: "PRIYANT1",
  }, admin);

  state = execute(state, {
    type: "order",
    customer: "Emma",
    product: "SKU-APPLE-2", // Apple Gala
    qty: 7,
    warehouse: "PRIYANT1",
  }, admin);

  const allEligibleIds = new Set(state.orders.map((o) => o.id));
  const consolidated = buildConsolidatedList(state.orders, state, allEligibleIds, "PRIYANT1");

  assert.equal(consolidated.length, 2);
  const apple1 = consolidated.find((c) => c.sku === "SKU-APPLE-1");
  const apple2 = consolidated.find((c) => c.sku === "SKU-APPLE-2");

  assert.ok(apple1);
  assert.ok(apple2);
  assert.equal(apple1.productName, "Apple Red Delicious");
  assert.equal(apple2.productName, "Apple Gala");
  assert.equal(apple1.totalRequired, 5);
  assert.equal(apple2.totalRequired, 7);
});

test("Scenario 4: User-controlled Date sorting (Oldest first vs Newest first)", () => {
  const productMap = new Map([
    ["SKU-APPLE-1", { id: "SKU-APPLE-1", name: "Apple Red Delicious" }],
  ]);

  const orders = [
    { id: "ORD-2", createdAt: "2026-11-22T08:00:00Z", product: "SKU-APPLE-1" },
    { id: "ORD-1", createdAt: "2026-11-20T08:00:00Z", product: "SKU-APPLE-1" },
    { id: "ORD-3", createdAt: "2026-11-24T08:00:00Z", product: "SKU-APPLE-1" },
  ];

  // Oldest first
  const asc = sortOrders(orders, productMap, {
    sortCriterion: "date",
    dateDirection: "asc",
    productDirection: "asc",
    combinedPriority: "date-first",
  });
  assert.deepEqual(asc.map((o) => o.id), ["ORD-1", "ORD-2", "ORD-3"]);

  // Newest first
  const desc = sortOrders(orders, productMap, {
    sortCriterion: "date",
    dateDirection: "desc",
    productDirection: "asc",
    combinedPriority: "date-first",
  });
  assert.deepEqual(desc.map((o) => o.id), ["ORD-3", "ORD-2", "ORD-1"]);
});

test("Scenario 5: User-controlled Product sorting (A–Z vs Z–A)", () => {
  const productMap = new Map([
    ["SKU-BANANA", { id: "SKU-BANANA", name: "Banana" }],
    ["SKU-APPLE", { id: "SKU-APPLE", name: "Apple" }],
    ["SKU-CHERRY", { id: "SKU-CHERRY", name: "Cherry" }],
  ]);

  const orders = [
    { id: "ORD-B", product: "SKU-BANANA" },
    { id: "ORD-A", product: "SKU-APPLE" },
    { id: "ORD-C", product: "SKU-CHERRY" },
  ];

  // A to Z
  const asc = sortOrders(orders, productMap, {
    sortCriterion: "product",
    dateDirection: "asc",
    productDirection: "asc",
    combinedPriority: "product-first",
  });
  assert.deepEqual(asc.map((o) => o.id), ["ORD-A", "ORD-B", "ORD-C"]);

  // Z to A
  const desc = sortOrders(orders, productMap, {
    sortCriterion: "product",
    dateDirection: "asc",
    productDirection: "desc",
    combinedPriority: "product-first",
  });
  assert.deepEqual(desc.map((o) => o.id), ["ORD-C", "ORD-B", "ORD-A"]);
});

test("Scenario 6: User-controlled Combined sorting (Date-first vs Product-first)", () => {
  const productMap = new Map([
    ["SKU-BANANA", { id: "SKU-BANANA", name: "Banana" }],
    ["SKU-APPLE", { id: "SKU-APPLE", name: "Apple" }],
  ]);

  const orders = [
    { id: "ORD-1", createdAt: "2026-11-20T10:00:00Z", product: "SKU-BANANA" },
    { id: "ORD-2", createdAt: "2026-11-20T10:00:00Z", product: "SKU-APPLE" },
    { id: "ORD-3", createdAt: "2026-11-21T10:00:00Z", product: "SKU-APPLE" },
  ];

  // Date first, then Product:
  // On 2026-11-20: Apple (ORD-2) before Banana (ORD-1). Then 2026-11-21: Apple (ORD-3).
  const dateFirst = sortOrders(orders, productMap, {
    sortCriterion: "both",
    dateDirection: "asc",
    productDirection: "asc",
    combinedPriority: "date-first",
  });
  assert.deepEqual(dateFirst.map((o) => o.id), ["ORD-2", "ORD-1", "ORD-3"]);

  // Product first, then Date:
  // Apple group: ORD-2 (20th), ORD-3 (21st). Then Banana group: ORD-1 (20th).
  const productFirst = sortOrders(orders, productMap, {
    sortCriterion: "both",
    dateDirection: "asc",
    productDirection: "asc",
    combinedPriority: "product-first",
  });
  assert.deepEqual(productFirst.map((o) => o.id), ["ORD-2", "ORD-3", "ORD-1"]);
});

test("Scenario 7: Default selection of all eligible orders, and selecting a subset", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "O1", product: "SKU-APPLE-1", qty: 2, warehouse: "PRIYANT1" }, admin);
  state = execute(state, { type: "order", customer: "O2", product: "SKU-APPLE-1", qty: 3, warehouse: "PRIYANT1" }, admin);
  state = execute(state, { type: "order", customer: "O3", product: "SKU-APPLE-1", qty: 5, warehouse: "PRIYANT1" }, admin);

  const o1 = state.orders[0].id;
  const o2 = state.orders[1].id;
  const o3 = state.orders[2].id;

  // Default selection: all 3 selected -> total 10
  const allIds = new Set([o1, o2, o3]);
  const listAll = buildConsolidatedList(state.orders, state, allIds, "PRIYANT1");
  assert.equal(listAll[0].totalRequired, 10);

  // Deselect o2: subset {o1, o3} -> total 7
  const subsetIds = new Set([o1, o3]);
  const listSubset = buildConsolidatedList(state.orders, state, subsetIds, "PRIYANT1");
  assert.equal(listSubset[0].totalRequired, 7);
  assert.equal(listSubset[0].contributingOrders.length, 2);

  // Deselect all: empty set -> empty consolidated list
  const listEmpty = buildConsolidatedList(state.orders, state, new Set(), "PRIYANT1");
  assert.equal(listEmpty.length, 0);
});

test("Scenario 8: Exclusion of cancelled and dispatched orders", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "Active", product: "SKU-APPLE-1", qty: 4, warehouse: "PRIYANT1" }, admin);
  const activeOrder = state.orders[0];

  state = execute(state, { type: "order", customer: "ToCancel", product: "SKU-APPLE-1", qty: 4, warehouse: "PRIYANT1" }, admin);
  const cancelOrder = state.orders[1];
  state = execute(state, { type: "cancel", order: cancelOrder.id, reason: "Customer changed mind" }, admin);

  assert.equal(state.orders.find((o) => o.id === cancelOrder.id).status, "Cancelled");

  // Ineligible orders should NOT be picked up by buildConsolidatedList
  const allIds = new Set(state.orders.map((o) => o.id));
  const consolidated = buildConsolidatedList(state.orders, state, allIds, "PRIYANT1");

  assert.equal(consolidated[0].totalRequired, 4);
  assert.equal(consolidated[0].contributingOrders.length, 1);
  assert.equal(consolidated[0].contributingOrders[0].orderId, activeOrder.id);
});

test("Scenario 9: Warehouse-specific picking and scoping", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "Priyant1 Customer", product: "SKU-APPLE-1", qty: 5, warehouse: "PRIYANT1" }, admin);
  state = execute(state, { type: "order", customer: "Priyant2 Customer", product: "SKU-APPLE-1", qty: 7, warehouse: "PRIYANT2" }, admin);

  const allIds = new Set(state.orders.map((o) => o.id));

  // Scoped to PRIYANT1
  const p1List = buildConsolidatedList(state.orders, state, allIds, "PRIYANT1");
  assert.equal(p1List.length, 1);
  assert.equal(p1List[0].totalRequired, 5);
  assert.equal(p1List[0].contributingOrders[0].customer, "Priyant1 Customer");

  // Scoped to PRIYANT2
  const p2List = buildConsolidatedList(state.orders, state, allIds, "PRIYANT2");
  assert.equal(p2List.length, 1);
  assert.equal(p2List[0].totalRequired, 7);
  assert.equal(p2List[0].contributingOrders[0].customer, "Priyant2 Customer");
});

test("Scenario 10: Location, batch, and expiry traceability in consolidated view", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "TrackCustomer", product: "SKU-APPLE-1", qty: 10, warehouse: "PRIYANT1" }, admin);

  const allIds = new Set(state.orders.map((o) => o.id));
  const list = buildConsolidatedList(state.orders, state, allIds, "PRIYANT1");

  assert.equal(list.length, 1);
  const locations = list[0].locations;
  assert.equal(locations.length, 1);
  assert.equal(locations[0].zone, "Zone A");
  assert.equal(locations[0].rack, "01");
  assert.equal(locations[0].bin, "BIN-A01");
  assert.equal(locations[0].batch, "BAT-A1");
  assert.equal(locations[0].expiry, "2027-12-31");
  assert.equal(locations[0].allocatedQty, 10);
});

test("Scenario 11: Partial picking releases unpicked reservations and tracks short picks", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "ShortPickCustomer", product: "SKU-APPLE-1", qty: 10, warehouse: "PRIYANT1" }, admin);
  const orderId = state.orders[0].id;

  const lot = state.lots.find((l) => l.id === "LOT-A1");
  assert.equal(lot.reserved, 10);

  // Assign task
  state = execute(state, { type: "assign", order: orderId, assignee: admin.id }, admin);

  // Short pick: pick 6 out of 10 with reason
  state = execute(state, {
    type: "pick",
    order: orderId,
    productBarcode: "111001",
    qty: 6,
    reason: "Damaged box on shelf",
  }, admin);

  const updatedOrder = state.orders.find((o) => o.id === orderId);
  assert.equal(updatedOrder.picked, 6);
  assert.equal(updatedOrder.status, "Short picked");
  // 4 unpicked units should have been released from reservation
  const updatedLot = state.lots.find((l) => l.id === "LOT-A1");
  assert.equal(updatedLot.reserved, 6);
  assert.equal(available(updatedLot), 44); // 50 - 6 = 44
});

test("Scenario 12: Order-wise packing separation and Ready to Pack validation", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "PackCustomer1", product: "SKU-APPLE-1", qty: 5, warehouse: "PRIYANT1" }, admin);
  state = execute(state, { type: "order", customer: "PackCustomer2", product: "SKU-BANANA", qty: 4, warehouse: "PRIYANT1" }, admin);

  const o1 = state.orders[0];
  const o2 = state.orders[1];

  // Assign both
  state = execute(state, { type: "assign", order: o1.id, assignee: admin.id }, admin);
  state = execute(state, { type: "assign", order: o2.id, assignee: admin.id }, admin);

  // Order 1 is awaiting pick
  assert.equal(getPackingReadiness(o1), "Awaiting Pick");

  // Pick Order 1 partially (3 of 5)
  state = execute(state, { type: "pick", order: o1.id, productBarcode: "111001", qty: 3, reason: "Partial pick" }, admin);
  const o1Partial = state.orders.find((o) => o.id === o1.id);
  assert.equal(getPackingReadiness(o1Partial), "Partially Picked");

  // Pick Order 2 fully (4 of 4)
  state = execute(state, { type: "pick", order: o2.id, productBarcode: "222001", qty: 4 }, admin);
  const o2Full = state.orders.find((o) => o.id === o2.id);
  assert.equal(getPackingReadiness(o2Full), "Ready to Pack");
  assert.equal(o2Full.status, "Picked");

  // Pack Order 2
  state = execute(state, {
    type: "pack",
    order: o2.id,
    productBarcode: "222001",
    qty: 4,
    material: "Box",
    dimensions: "10x10x10",
    weight: 2,
  }, admin);
  const o2Packed = state.orders.find((o) => o.id === o2.id);
  assert.equal(getPackingReadiness(o2Packed), "Packed");
  assert.equal(o2Packed.status, "Packed");
});

test("Scenario 13: Duplicate pick prevention and invalid status transitions", () => {
  let state = createTestState();

  state = execute(state, { type: "order", customer: "DupTest", product: "SKU-APPLE-1", qty: 5, warehouse: "PRIYANT1" }, admin);
  const o = state.orders[0];
  state = execute(state, { type: "assign", order: o.id, assignee: admin.id }, admin);

  // Pick fully
  state = execute(state, { type: "pick", order: o.id, productBarcode: "111001", qty: 5 }, admin);
  assert.equal(state.orders[0].status, "Picked");

  // Attempt duplicate pick on already picked order: must throw Error
  assert.throws(() => {
    execute(state, { type: "pick", order: o.id, productBarcode: "111001", qty: 5 }, admin);
  }, /Order is not awaiting picking/);

  // Attempt to pick with excess quantity
  state = execute(state, { type: "order", customer: "ExcessTest", product: "SKU-APPLE-1", qty: 5, warehouse: "PRIYANT1" }, admin);
  const o2 = state.orders[1];
  state = execute(state, { type: "assign", order: o2.id, assignee: admin.id }, admin);
  assert.throws(() => {
    execute(state, { type: "pick", order: o2.id, productBarcode: "111001", qty: 10 }, admin);
  }, /Picked quantity exceeds ordered quantity/);
});

test("Scenario 14: Data integrity: Zero duplicate deductions across entire lifecycle", () => {
  let state = createTestState();

  const initialPhysical = state.lots.reduce((sum, l) => sum + l.qty, 0);

  // 1. Order created: physical stock must NOT change
  state = execute(state, { type: "order", customer: "EndToEnd", product: "SKU-APPLE-1", qty: 10, warehouse: "PRIYANT1" }, admin);
  const orderId = state.orders[0].id;
  assert.equal(state.lots.reduce((sum, l) => sum + l.qty, 0), initialPhysical);

  // 2. Assign: physical stock must NOT change
  state = execute(state, { type: "assign", order: orderId, assignee: admin.id }, admin);
  assert.equal(state.lots.reduce((sum, l) => sum + l.qty, 0), initialPhysical);

  // 3. Sorting & Consolidated viewing: non-mutating
  const allIds = new Set(state.orders.map((o) => o.id));
  buildConsolidatedList(state.orders, state, allIds, "PRIYANT1");
  assert.equal(state.lots.reduce((sum, l) => sum + l.qty, 0), initialPhysical);

  // 4. Pick: physical stock must NOT change (only reserved)
  state = execute(state, { type: "pick", order: orderId, productBarcode: "111001", qty: 10 }, admin);
  assert.equal(state.lots.reduce((sum, l) => sum + l.qty, 0), initialPhysical);

  // 5. Pack: physical stock must NOT change
  state = execute(state, {
    type: "pack",
    order: orderId,
    productBarcode: "111001",
    qty: 10,
    material: "Carton",
    dimensions: "20x20x20",
    weight: 3,
  }, admin);
  assert.equal(state.lots.reduce((sum, l) => sum + l.qty, 0), initialPhysical);

  // 6. Dispatch: physical stock is deducted EXACTLY ONCE
  state = execute(state, {
    type: "dispatch",
    order: orderId,
    courier: "Express Delivery",
    tracking: "TRK-001",
    qty: 10,
  }, admin);

  const finalPhysical = state.lots.reduce((sum, l) => sum + l.qty, 0);
  assert.equal(finalPhysical, initialPhysical - 10);
  assert.equal(state.orders[0].status, "Dispatched");
});
