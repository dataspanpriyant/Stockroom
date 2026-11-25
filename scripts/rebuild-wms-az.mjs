import fs from "node:fs";
import path from "node:path";
import { expectedZoneForProduct, evaluateProductCompliance } from "../lib/wms.ts";

const dataFile = path.join(process.cwd(), "data", "warehouse.json");
const backupDir = path.join(process.cwd(), "data-backup");

if (!fs.existsSync(dataFile)) {
  console.error("FATAL: data/warehouse.json does not exist!");
  process.exit(1);
}

// 1. Mandatory Pre-Reset Backup Check
const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => f.startsWith("warehouse-pre-reset-")) : [];
if (!backups.length) {
  console.error("FATAL: No pre-reset backup found in data-backup/! Halting.");
  process.exit(1);
}
console.log(`Verified pre-reset backup exists: ${backups[backups.length - 1]}`);

// 2. Load current state
const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));

// Confirm 5 warehouses
const expectedWarehouses = ["PRIYANT1", "PRIYANT2", "PRIYANT3", "PRIYANT4", "PRIYANT5"];
const currentWhIds = state.warehouses.map(w => w.id);
for (const id of expectedWarehouses) {
  if (!currentWhIds.includes(id)) {
    console.error(`FATAL: Warehouse ${id} missing from warehouses list!`);
    process.exit(1);
  }
}
console.log(`Confirmed all 5 warehouses: ${expectedWarehouses.join(", ")}`);

// 3. Define the 26 A-Z Sample Product Catalog
const catalogSpecs = [
  { letter: "A", name: "Apple", category: "Fresh Produce", price: 120, minimum: 20, unit: "kg", productType: "Perishable", expiryTracking: true, defaultShelfLifeDays: 30 },
  { letter: "B", name: "Backpack", category: "Luggage & Bags", price: 1899, minimum: 15, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "C", name: "Ceramic Mug", category: "Home & Living", price: 349, minimum: 25, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "D", name: "Desk Organizer", category: "Office Supplies", price: 599, minimum: 20, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "E", name: "Ethernet Cable", category: "Electronics", price: 299, minimum: 30, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "F", name: "Folding Chair", category: "Furniture", price: 1499, minimum: 10, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "G", name: "Glass Bottle", category: "Kitchenware", price: 450, minimum: 25, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "H", name: "Headphones", category: "Electronics", price: 2499, minimum: 15, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "I", name: "Ironing Board", category: "Home Appliances", price: 1799, minimum: 10, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "J", name: "Jacket", category: "Apparel", price: 2999, minimum: 12, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "K", name: "Kitchen Towel", category: "Home Textiles", price: 199, minimum: 40, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "L", name: "Laptop Stand", category: "Computer Accessories", price: 1199, minimum: 15, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "M", name: "Mouse Pad", category: "Computer Accessories", price: 399, minimum: 30, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "N", name: "Notebook", category: "Stationery", price: 150, minimum: 50, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "O", name: "Office Chair", category: "Furniture", price: 6499, minimum: 8, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "P", name: "Pen Set", category: "Stationery", price: 249, minimum: 35, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "Q", name: "Quilt", category: "Bedding", price: 2199, minimum: 10, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "R", name: "Router", category: "Networking", price: 2299, minimum: 12, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "S", name: "Storage Box", category: "Storage & Organization", price: 499, minimum: 25, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "T", name: "Travel Mug", category: "Drinkware", price: 699, minimum: 20, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "U", name: "USB Cable", category: "Electronics", price: 199, minimum: 50, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "V", name: "Vacuum Flask", category: "Drinkware", price: 899, minimum: 15, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "W", name: "Water Bottle", category: "Outdoors", price: 399, minimum: 30, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "X", name: "Xylophone", category: "Musical Instruments", price: 1299, minimum: 10, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "Y", name: "Yoga Mat", category: "Fitness", price: 799, minimum: 20, unit: "unit", productType: "Non-perishable", expiryTracking: false },
  { letter: "Z", name: "Zipper Pouch", category: "Accessories", price: 179, minimum: 40, unit: "unit", productType: "Non-perishable", expiryTracking: false },
];

const newProducts = catalogSpecs.map((spec, index) => {
  const num = String(index + 1).padStart(3, "0");
  const barcode = String(89020000 + index + 1);
  const id = `PRD-${spec.letter}-${num}`;
  const expZone = expectedZoneForProduct(spec.name);
  if (expZone !== spec.letter) {
    throw new Error(`Catalog verification failed: ${spec.name} maps to ${expZone}, expected ${spec.letter}`);
  }
  return {
    id,
    name: spec.name,
    category: spec.category,
    barcode,
    minimum: spec.minimum,
    price: spec.price,
    promotion: "",
    unit: spec.unit,
    productType: spec.productType,
    expiryTracking: spec.expiryTracking,
    serialTracking: false,
    ...(spec.defaultShelfLifeDays ? { defaultShelfLifeDays: spec.defaultShelfLifeDays } : {}),
  };
});
console.log(`Verified 26 A-Z product master records generated cleanly.`);

// 4. Generate Locations for All 5 Warehouses (26 Zones A-Z + 1 Quarantine per warehouse)
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const newLocations = [];
const newLayoutBlocks = [];

for (const wId of expectedWarehouses) {
  let lane0Y = 24;
  let lane1Y = 24;

  letters.forEach((letter, index) => {
    const rackId = "01";
    const sectionId = `${letter}-01-01`;

    // Bin 1 (Primary assigned bin)
    const bin1Id = `${wId}-${letter}-R1C1`;
    newLocations.push({
      id: bin1Id,
      name: `Zone ${letter} R1C1`,
      warehouse: wId,
      zone: letter,
      rack: rackId,
      section: sectionId,
      row: 1,
      column: 1,
      shelf: 1,
      capacity: 100,
      kind: "Storage",
      assignedProduct: wId === "PRIYANT1" ? newProducts[index].id : undefined,
    });

    // Bin 2 (Secondary expansion bin)
    const bin2Id = `${wId}-${letter}-R1C2`;
    newLocations.push({
      id: bin2Id,
      name: `Zone ${letter} R1C2`,
      warehouse: wId,
      zone: letter,
      rack: rackId,
      section: sectionId,
      row: 1,
      column: 2,
      shelf: 1,
      capacity: 100,
      kind: "Storage",
    });

    // Create persistent layout blocks for visualization in PRIYANT1
    if (wId === "PRIYANT1") {
      const isEven = index % 2 === 0;
      const x = isEven ? 24 : 454;
      const y = isEven ? lane0Y : lane1Y;
      const height = 166;
      const width = 390;

      // Zone Block
      newLayoutBlocks.push({
        warehouse: wId,
        zone: letter,
        x,
        y,
        width,
        height,
      });

      // Rack Block inside zone
      newLayoutBlocks.push({
        warehouse: wId,
        zone: letter,
        rack: rackId,
        x: 12,
        y: 12,
        width: 358,
        height: 110,
      });

      if (isEven) lane0Y += height + 30;
      else lane1Y += height + 30;
    }
  });

  // Quarantine Location
  const qId = `${wId}-QUARANTINE`;
  newLocations.push({
    id: qId,
    name: "Quarantine",
    warehouse: wId,
    zone: "QUARANTINE",
    rack: "QUARANTINE",
    section: "QUARANTINE-01",
    row: 1,
    column: 1,
    shelf: 1,
    capacity: 1000000,
    kind: "Storage",
    blocked: true,
  });

  if (wId === "PRIYANT1") {
    const maxY = Math.max(lane0Y, lane1Y);
    newLayoutBlocks.push({
      warehouse: wId,
      zone: "QUARANTINE",
      x: 24,
      y: maxY,
      width: 820,
      height: 180,
    });
    newLayoutBlocks.push({
      warehouse: wId,
      zone: "QUARANTINE",
      rack: "QUARANTINE",
      x: 12,
      y: 12,
      width: 790,
      height: 120,
    });
  }
}
console.log(`Generated ${newLocations.length} locations across 5 warehouses (130 A-Z zones + 5 quarantine zones).`);

// 5. Seed Sample Inventory (Lots) in Matching Alphabetical Zones
const newLots = [];

// Seed all 26 products in primary warehouse PRIYANT1
newProducts.forEach((product, index) => {
  const letter = letters[index];
  const lotId = `LOT-${letter}-MUM-01`;
  const locId = `PRIYANT1-${letter}-R1C1`;
  const batch = `MUM-26-${letter}01`;
  const expiry = product.expiryTracking ? "2027-12-31" : "2029-12-31";
  const qty = 20 + ((index * 3) % 40); // realistic quantities 20-59

  newLots.push({
    id: lotId,
    product: product.id,
    batch,
    expiry,
    location: locId,
    warehouse: "PRIYANT1",
    qty,
    reserved: 0,
    putAwayBy: "Jordan Miller",
    putAwayAt: new Date().toISOString(),
  });
});

// Seed selective regional stock in other 4 warehouses (always in matching alphabetical zones)
const regionalStock = [
  // PRIYANT2 (Delhi)
  { w: "PRIYANT2", letter: "E", qty: 35, batch: "DEL-26-E01", exp: "2029-12-31" },
  { w: "PRIYANT2", letter: "L", qty: 25, batch: "DEL-26-L01", exp: "2029-12-31" },
  { w: "PRIYANT2", letter: "R", qty: 20, batch: "DEL-26-R01", exp: "2029-12-31" },

  // PRIYANT3 (Bengaluru)
  { w: "PRIYANT3", letter: "H", qty: 30, batch: "BLR-26-H01", exp: "2029-12-31" },
  { w: "PRIYANT3", letter: "M", qty: 45, batch: "BLR-26-M01", exp: "2029-12-31" },
  { w: "PRIYANT3", letter: "U", qty: 50, batch: "BLR-26-U01", exp: "2029-12-31" },

  // PRIYANT4 (Chennai)
  { w: "PRIYANT4", letter: "C", qty: 40, batch: "CHE-26-C01", exp: "2029-12-31" },
  { w: "PRIYANT4", letter: "G", qty: 35, batch: "CHE-26-G01", exp: "2029-12-31" },
  { w: "PRIYANT4", letter: "W", qty: 45, batch: "CHE-26-W01", exp: "2029-12-31" },

  // PRIYANT5 (Kolkata)
  { w: "PRIYANT5", letter: "J", qty: 20, batch: "KOL-26-J01", exp: "2029-12-31" },
  { w: "PRIYANT5", letter: "K", qty: 50, batch: "KOL-26-K01", exp: "2029-12-31" },
  { w: "PRIYANT5", letter: "T", qty: 30, batch: "KOL-26-T01", exp: "2029-12-31" },
];

regionalStock.forEach((item, idx) => {
  const prodIndex = letters.indexOf(item.letter);
  const prod = newProducts[prodIndex];
  const lotId = `LOT-${item.letter}-${item.w.slice(-4)}-${idx + 1}`;
  const locId = `${item.w}-${item.letter}-R1C1`;

  newLots.push({
    id: lotId,
    product: prod.id,
    batch: item.batch,
    expiry: item.exp,
    location: locId,
    warehouse: item.w,
    qty: item.qty,
    reserved: 0,
    putAwayBy: "Jordan Miller",
    putAwayAt: new Date().toISOString(),
  });
});

console.log(`Generated ${newLots.length} sample inventory lots (all stored in matching alphabetical zones).`);

// 6. Pre-save Compliance Check
const testState = {
  products: newProducts,
  locations: newLocations,
  lots: newLots,
};

let compliantCount = 0;
let mismatchCount = 0;
for (const lot of newLots) {
  const comp = evaluateProductCompliance(testState, lot);
  if (comp.compliance === "Correct Location") {
    compliantCount++;
  } else {
    mismatchCount++;
    console.error(`COMPLIANCE FAILURE: Lot ${lot.id} has status ${comp.compliance}! Expected: ${comp.expectedZone}, Actual: ${comp.actualZone}`);
  }
}

if (mismatchCount > 0) {
  console.error(`FATAL: ${mismatchCount} compliance failures detected! Halting.`);
  process.exit(1);
}
console.log(`Pre-save validation PASSED: 100% of sample lots (${compliantCount}/${newLots.length}) are in Correct Location!`);

// 7. Assemble Clean State
state.products = newProducts;
state.sampleProducts = []; // Cleared
state.locations = newLocations;
state.lots = newLots;
state.orders = []; // Cleared old demo orders
state.receipts = []; // Cleared old demo receipts
state.receivingSessions = []; // Cleared
state.purchaseOrders = []; // Cleared
state.returns = []; // Cleared
state.approvals = []; // Cleared
state.layoutBlocks = newLayoutBlocks;
state.layoutSections = [];
state.rackGrids = [];
state.stores = [
  { id: "STORE-01", name: "Northstar Central" },
  { id: "STORE-02", name: "Northstar South" },
];

// Record reset audit event
state.events.unshift({
  id: `EVT-${Date.now().toString(36)}`,
  at: new Date().toISOString(),
  actor: "System Administrator",
  action: "DATABASE_RESET_AZ_ZONES",
  reference: "RESET-A-Z-APPROVED",
  detail: `Successfully completed approved reset: 26 global A-Z products, 130 alphabetical zones across 5 warehouses, ${newLots.length} compliant inventory lots.`,
});

// 8. Atomic Write
const tmpFile = dataFile + ".tmp";
fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf8");
fs.renameSync(tmpFile, dataFile);

console.log("ATOMIC_REBUILD_SUCCESSFUL");
console.log(`Wrote clean state to ${dataFile}`);
