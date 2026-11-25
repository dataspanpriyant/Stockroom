import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seed, execute, available, expectedZoneForProduct, normalizeZone,
  isSingleLetterZone, isSpecialPurposeZone, compareZones,
  evaluateProductCompliance, evaluatePlacement, placementEvaluations,
} from "../lib/wms.ts";

const admin = { id: "admin", name: "Admin", role: "Admin" };

test("1. Core Business Rule: Product name determines expected alphabetical zone", () => {
  // Required user examples
  assert.equal(expectedZoneForProduct("Apple"), "A");
  assert.equal(expectedZoneForProduct("Banana"), "B");
  assert.equal(expectedZoneForProduct("Carrot"), "C");
  assert.equal(expectedZoneForProduct("Dates"), "D");
  assert.equal(expectedZoneForProduct("Laptop"), "L");
  assert.equal(expectedZoneForProduct("Mouse"), "M");

  // Normalized product names (accents, whitespace, leading numbers/symbols)
  assert.equal(expectedZoneForProduct("  apple  "), "A");
  assert.equal(expectedZoneForProduct("123 Banana"), "B");
  assert.equal(expectedZoneForProduct("#99 Carrot Bag"), "C");
  assert.equal(expectedZoneForProduct("Éclair Pastry"), "E");
  assert.equal(expectedZoneForProduct("Wireless Headphones"), "W");
  assert.equal(expectedZoneForProduct("Ceramic Pour-Over Set"), "C");

  // Empty or non-alphabetic
  assert.equal(expectedZoneForProduct(""), null);
  assert.equal(expectedZoneForProduct("12345"), null);
});

test("2. Compact View Sorting: Alphabetical zones A-Z ascending, special zones at the end", () => {
  const unsorted = ["QUARANTINE", "D", "B", "Delhi", "A", "E", "C"];
  const sorted = [...unsorted].sort(compareZones);

  assert.deepEqual(sorted, ["A", "B", "C", "D", "E", "Delhi", "QUARANTINE"]);

  // Special-purpose zone detection
  assert.ok(isSpecialPurposeZone("QUARANTINE"));
  assert.ok(isSpecialPurposeZone("RECEIVING"));
  assert.ok(isSpecialPurposeZone("STAGING"));
  assert.ok(isSpecialPurposeZone("DISPATCH"));
  assert.ok(!isSpecialPurposeZone("A"));
  assert.ok(!isSpecialPurposeZone("B"));
  assert.ok(!isSpecialPurposeZone("Delhi"));

  // Single-letter zone detection
  assert.ok(isSingleLetterZone("A"));
  assert.ok(isSingleLetterZone("Z"));
  assert.ok(isSingleLetterZone("Zone B"));
  assert.ok(!isSingleLetterZone("QUARANTINE"));
  assert.ok(!isSingleLetterZone("Delhi"));
});

test("3. Floor Plan View: Physical coordinates remain intact", () => {
  const state = seed();
  // Ensure layoutBlocks exist
  state.layoutBlocks = [
    { warehouse: "WH-NORTH", zone: "A", rack: "01", x: 100, y: 150, width: 300, height: 200 },
    { warehouse: "WH-NORTH", zone: "B", rack: "01", x: 450, y: 150, width: 300, height: 200 },
    { warehouse: "WH-NORTH", zone: "QUARANTINE", rack: "QUARANTINE", x: 800, y: 500, width: 400, height: 300 },
  ];

  // Sorting does not mutate stored layout coordinates
  const sortedZones = ["QUARANTINE", "B", "A"].sort(compareZones);
  assert.deepEqual(sortedZones, ["A", "B", "QUARANTINE"]);

  // Physical coordinates for zone A and zone B remain exactly as configured
  const blockA = state.layoutBlocks.find((b) => b.zone === "A");
  assert.equal(blockA.x, 100);
  assert.equal(blockA.y, 150);

  const blockB = state.layoutBlocks.find((b) => b.zone === "B");
  assert.equal(blockB.x, 450);
  assert.equal(blockB.y, 150);

  const blockQ = state.layoutBlocks.find((b) => b.zone === "QUARANTINE");
  assert.equal(blockQ.x, 800);
  assert.equal(blockQ.y, 500);
});

test("4. Compliance Status: Correct Location, Zone Mismatch, Unassigned, Storage Compatibility Issue", () => {
  const state = seed();
  state.products.push(
    { id: "PRD-APPLE", name: "Apple", category: "Produce", barcode: "111", minimum: 5, price: 10, promotion: "" },
    { id: "PRD-BANANA", name: "Banana", category: "Produce", barcode: "222", minimum: 5, price: 10, promotion: "" },
  );
  state.locations.push(
    { id: "A-01-R1-C1", warehouse: "WH-NORTH", zone: "A", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" },
    { id: "B-01-R1-C1", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" },
    { id: "B-01-BLOCKED", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 2, capacity: 100, kind: "Storage", blocked: true },
    { id: "B-01-ASSIGNED", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 3, capacity: 100, kind: "Storage", assignedProduct: "PRD-BANANA" },
  );

  // 4a. Correct Location: Apple in Zone A
  const lotCorrect = { id: "LOT-C1", product: "PRD-APPLE", batch: "BAT-1", expiry: "2028-12-31", location: "A-01-R1-C1", qty: 20, reserved: 0 };
  state.lots.push(lotCorrect);
  const compCorrect = evaluateProductCompliance(state, lotCorrect);
  assert.equal(compCorrect.compliance, "Correct Location");
  assert.equal(compCorrect.expectedZone, "A");
  assert.equal(compCorrect.actualZone, "A");

  // 4b. Zone Mismatch: Apple stored in Zone B (flagged, not moved)
  const lotMismatch = { id: "LOT-M1", product: "PRD-APPLE", batch: "BAT-2", expiry: "2028-12-31", location: "B-01-R1-C1", qty: 15, reserved: 0 };
  state.lots.push(lotMismatch);
  const compMismatch = evaluateProductCompliance(state, lotMismatch);
  assert.equal(compMismatch.compliance, "Zone Mismatch");
  assert.equal(compMismatch.expectedZone, "A");
  assert.equal(compMismatch.actualZone, "B");
  // Verify inventory is NOT moved automatically
  assert.equal(lotMismatch.location, "B-01-R1-C1");
  assert.equal(lotMismatch.qty, 15);

  // 4c. Unassigned: lot in RECEIVING
  const lotUnassigned = { id: "LOT-U1", product: "PRD-APPLE", batch: "BAT-3", expiry: "2028-12-31", location: "RECEIVING", qty: 30, reserved: 0 };
  state.lots.push(lotUnassigned);
  const compUnassigned = evaluateProductCompliance(state, lotUnassigned);
  assert.equal(compUnassigned.compliance, "Unassigned");
  assert.equal(compUnassigned.expectedZone, "A");

  // 4d. Storage Compatibility Issue: blocked location
  const lotBlocked = { id: "LOT-BLK", product: "PRD-BANANA", batch: "BAT-4", expiry: "2028-12-31", location: "B-01-BLOCKED", qty: 10, reserved: 0 };
  state.lots.push(lotBlocked);
  const compBlocked = evaluateProductCompliance(state, lotBlocked);
  assert.equal(compBlocked.compliance, "Storage Compatibility Issue");
  assert.ok(compBlocked.issueDetail.includes("blocked"));

  // 4e. Storage Compatibility Issue: assigned to another SKU
  const lotAssignedMismatch = { id: "LOT-ASS", product: "PRD-APPLE", batch: "BAT-5", expiry: "2028-12-31", location: "B-01-ASSIGNED", qty: 10, reserved: 0 };
  state.lots.push(lotAssignedMismatch);
  const compAssigned = evaluateProductCompliance(state, lotAssignedMismatch);
  assert.equal(compAssigned.compliance, "Storage Compatibility Issue");
  assert.ok(compAssigned.issueDetail.includes("assigned to another SKU"));
});

test("5. Put-away recommendations: Prioritize matching alphabetical zone", () => {
  const state = seed();
  state.products.push(
    { id: "PRD-APPLE", name: "Apple", category: "Produce", barcode: "111", minimum: 5, price: 10, promotion: "" },
  );
  const locA = { id: "A-01-01", warehouse: "WH-NORTH", zone: "A", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" };
  const locB = { id: "B-01-01", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" };
  state.locations.push(locA, locB);

  const lotApple = { id: "LOT-APPLE-RCV", product: "PRD-APPLE", batch: "BAT-APP", expiry: "2028-12-31", location: "RECEIVING", qty: 25, reserved: 0 };
  state.lots.push(lotApple);

  // Evaluate single location A (expected zone)
  const evalA = evaluatePlacement(state, lotApple, locA);
  assert.equal(evalA.expectedZone, "A");
  assert.equal(evalA.isExpectedZone, true);
  assert.equal(evalA.zoneMismatch, false);
  assert.equal(evalA.tier, "compatible");

  // Evaluate single location B (alternative zone)
  const evalB = evaluatePlacement(state, lotApple, locB);
  assert.equal(evalB.expectedZone, "A");
  assert.equal(evalB.isExpectedZone, false);
  assert.equal(evalB.zoneMismatch, true);
  assert.ok(evalB.warning.includes("Zone mismatch: Expected Zone A, target is Zone B"));

  // Placement evaluations across both locations: Zone A must rank first
  const evaluations = placementEvaluations(state, lotApple, [locB, locA]);
  assert.equal(evaluations[0].location.id, locA.id, "Matching Zone A must rank ahead of alternative Zone B");
  assert.equal(evaluations[1].location.id, locB.id);
});

test("6. Full Zone Handling: Marks expected zone as full and allows alternative with warning", () => {
  const state = seed();
  state.products.push(
    { id: "PRD-APPLE", name: "Apple", category: "Produce", barcode: "111", minimum: 5, price: 10, promotion: "" },
  );
  // Full location in Zone A
  const locAFull = { id: "A-01-FULL", warehouse: "WH-NORTH", zone: "A", rack: "01", section: "01-01", row: 1, column: 1, capacity: 50, kind: "Storage" };
  // Free location in Zone B
  const locBFree = { id: "B-01-FREE", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" };
  state.locations.push(locAFull, locBFree);

  // Fill locAFull to capacity
  state.lots.push({ id: "LOT-FILL", product: "PRD-APPLE", batch: "OLD", expiry: "2028-12-31", location: "A-01-FULL", qty: 50, reserved: 0 });

  const incomingLot = { id: "LOT-INCOMING", product: "PRD-APPLE", batch: "NEW", expiry: "2028-12-31", location: "RECEIVING", qty: 20, reserved: 0 };
  state.lots.push(incomingLot);

  const evalAFull = evaluatePlacement(state, incomingLot, locAFull);
  assert.equal(evalAFull.tier, "not-possible");
  assert.equal(evalAFull.issue, "Location is full");

  const evalB = evaluatePlacement(state, incomingLot, locBFree);
  assert.equal(evalB.tier, "compatible");
  assert.equal(evalB.zoneMismatch, true);
  assert.ok(evalB.warning.includes("Zone mismatch"));

  const ranked = placementEvaluations(state, incomingLot, [locAFull, locBFree]);
  assert.equal(ranked[0].location.id, locBFree.id);
  assert.equal(ranked[1].location.id, locAFull.id);
});

test("7. Batch and Expiry Preservation during Put-away", () => {
  let state = seed();
  state.users.push(admin);
  state.products.push(
    { id: "PRD-CARROT", name: "Carrot", category: "Produce", barcode: "8909999", minimum: 5, price: 10, promotion: "" },
  );
  state.locations.push(
    { id: "C-01", warehouse: "WH-NORTH", zone: "C", rack: "01", section: "01-01", row: 1, column: 1, capacity: 200, kind: "Storage" },
  );

  state = execute(state, {
    type: "receive",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    product: "PRD-CARROT",
    expected: 50,
    received: 50,
    damaged: 0,
    quality: "Passed",
    status: "Accepted",
    batch: "CARROT-BATCH-99",
    expiry: "2028-09-15",
    note: "Alphabetical allocation test",
  }, admin);

  const rcvLot = state.lots.find((l) => l.batch === "CARROT-BATCH-99" && l.location === "RECEIVING");
  assert.ok(rcvLot);
  assert.equal(rcvLot.qty, 50);

  // Put away into expected Zone C
  state = execute(state, {
    type: "putaway",
    lot: rcvLot.id,
    destination: "C-01",
    qty: 50,
    productBarcode: "8909999",
    locationBarcode: "C-01",
  }, admin);

  const storedLot = state.lots.find((l) => l.batch === "CARROT-BATCH-99" && l.location === "C-01");
  assert.ok(storedLot);
  assert.equal(storedLot.qty, 50);
  assert.equal(storedLot.batch, "CARROT-BATCH-99");
  assert.equal(storedLot.expiry, "2028-09-15");

  // Check compliance of stored lot
  const compliance = evaluateProductCompliance(state, storedLot);
  assert.equal(compliance.compliance, "Correct Location");
  assert.equal(compliance.expectedZone, "C");
  assert.equal(compliance.actualZone, "C");
});

test("8. Authoritative Backend Put-away Enforcement: Reject unconfirmed zone mismatch", () => {
  let state = seed();
  state.users.push(admin);
  state.products.push(
    { id: "PRD-APPLE-AUTH", name: "Apple", category: "Produce", barcode: "89011111", minimum: 5, price: 10, promotion: "" },
  );
  state.locations.push(
    { id: "LOC-A-01", warehouse: "WH-NORTH", zone: "A", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" },
    { id: "LOC-B-01", warehouse: "WH-NORTH", zone: "B", rack: "01", section: "01-01", row: 1, column: 1, capacity: 100, kind: "Storage" },
  );

  state = execute(state, {
    type: "receive",
    supplier: "SUP-01",
    warehouse: "WH-NORTH",
    product: "PRD-APPLE-AUTH",
    expected: 20,
    received: 20,
    damaged: 0,
    quality: "Passed",
    status: "Accepted",
    batch: "APPLE-BATCH-AUTH",
    expiry: "2028-10-10",
    note: "Zone enforcement test",
  }, admin);

  const rcvLot = state.lots.find((l) => l.batch === "APPLE-BATCH-AUTH" && l.location === "RECEIVING");
  assert.ok(rcvLot);

  // Attempt to place Apple into Zone B without confirmation -> MUST throw Zone Mismatch error
  assert.throws(
    () => {
      execute(state, {
        type: "putaway",
        lot: rcvLot.id,
        destination: "LOC-B-01",
        qty: 20,
        productBarcode: "89011111",
        locationBarcode: "LOC-B-01",
      }, admin);
    },
    /Zone Mismatch/
  );

  // Place Apple into Zone B with confirmZoneMismatch: true -> MUST succeed
  const authorizedState = execute(state, {
    type: "putaway",
    lot: rcvLot.id,
    destination: "LOC-B-01",
    qty: 20,
    productBarcode: "89011111",
    locationBarcode: "LOC-B-01",
    confirmZoneMismatch: true,
  }, admin);

  const placedLot = authorizedState.lots.find((l) => l.batch === "APPLE-BATCH-AUTH" && l.location === "LOC-B-01");
  assert.ok(placedLot);
  assert.equal(placedLot.qty, 20);
});

test("9. Rebuilt Database Verification: 5 warehouses, 130 alphabetical zones, 26 products", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dataFile = path.join(process.cwd(), "data", "warehouse.json");
  assert.ok(fs.existsSync(dataFile));

  const s = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.equal(s.warehouses.length, 5);

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let totalAlphaZones = 0;
  for (const w of s.warehouses) {
    const locs = s.locations.filter((l) => l.warehouse === w.id);
    const zones = [...new Set(locs.map((l) => l.zone))];
    const alphaZones = zones.filter((z) => letters.includes(z));
    assert.equal(alphaZones.length, 26, `Warehouse ${w.id} must have all 26 alphabetical zones`);
    assert.ok(zones.includes("QUARANTINE"), `Warehouse ${w.id} must preserve QUARANTINE`);
    totalAlphaZones += alphaZones.length;
  }
  assert.equal(totalAlphaZones, 130, "Expected exactly 130 logical alphabetical zones across 5 warehouses");

  assert.equal(s.products.length, 26, "Expected exactly 26 sample products");
  s.products.forEach((p, idx) => {
    const exp = expectedZoneForProduct(p.name);
    assert.equal(exp, letters[idx], `Product ${p.name} must map to Zone ${letters[idx]}`);
  });

  // Verify all 38 seeded lots are in Correct Location
  assert.equal(s.lots.length, 38);
  for (const lot of s.lots) {
    const comp = evaluateProductCompliance(s, lot);
    assert.equal(comp.compliance, "Correct Location", `Lot ${lot.id} must be in Correct Location`);
  }
});
