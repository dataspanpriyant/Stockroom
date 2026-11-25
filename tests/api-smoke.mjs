import assert from "node:assert/strict";
const origin = process.env.WMS_TEST_URL || "http://127.0.0.1:3011";
const cookie = {};
async function post(data, who = "admin", expected = 200) {
  const res = await fetch(origin + "/api/wms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie[who] ? { Cookie: cookie[who] } : {}),
    },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  assert.equal(res.status, expected, JSON.stringify(body));
  if (data.type === "selectUser" && res.ok)
    cookie[who] = res.headers.get("set-cookie").split(";")[0];
  return body;
}
const direct = await fetch(origin + "/api/wms");
assert.equal(direct.status, 200);
let { state: s, user } = await direct.json();
assert.equal(user.role, "Admin");
assert.ok(s.users.every((u) => !("password" in u)));
({ state: s, user } = await post({ type: "selectUser", id: "supervisor" }, "supervisor"));
assert.equal(user.role, "Supervisor");
({ state: s, user } = await post({ type: "selectUser", id: "viewer" }, "viewer"));
assert.equal(user.role, "Viewer");
({ state: s, user } = await post({ type: "selectUser", id: "admin" }, "admin"));
assert.equal(user.role, "Admin");
const baseline = s.lots.reduce((n, l) => n + l.qty, 0);
const warehouse = s.warehouses[0].id,
  supplier = s.suppliers[0].id,
  productRecord = s.products.find((p) => s.lots.some((l) => l.product === p.id && l.location !== "RECEIVING" && l.qty > 0)) || s.products[0],
  product = productRecord.id,
  productBarcode = productRecord.barcode,
  destinationRecord = s.locations.find((location) => location.warehouse === warehouse && location.kind === "Storage" && !location.blocked && (!location.assignedProduct || location.assignedProduct === product) && location.capacity - s.lots.filter((lot) => lot.location === location.id).reduce((n, lot) => n + lot.qty, 0) >= 8),
  destination = destinationRecord?.id,
  countLot = s.lots.find((lot) => lot.location !== "RECEIVING" && lot.qty > 0 && lot.reserved === 0),
  batch = "HTTP-" + Date.now();
assert.ok(destination, "Expected a receiving destination with capacity");
assert.ok(countLot, "Expected an existing lot for cycle-count smoke coverage");
({ state: s } = await post({
  type: "receive",
  supplier,
  product,
  warehouse,
  expected: 10,
  received: 9,
  damaged: 1,
  quality: "Passed",
  batch,
  expiry: "2029-01-01",
  note: "One missing and one damaged",
}));
const receipt = s.receipts.at(-1),
  lot = s.lots.at(-1);
assert.equal(receipt.accepted, 8);
assert.equal(lot.location, "RECEIVING");
({ state: s } = await post({
  type: "putaway",
  lot: lot.id,
  destination,
  qty: 8,
  productBarcode,
  locationBarcode: destination,
}));
({ state: s } = await post({
  type: "order",
  customer: "HTTP acceptance buyer",
  product,
  qty: 5,
  warehouse,
}));
const id = s.orders.at(-1).id;
({ state: s } = await post({ type: "assign", order: id, assignee: "admin" }));
({ state: s } = await post({
  type: "pick",
  order: id,
  qty: 5,
  productBarcode,
}));
assert.equal(
  s.lots.reduce((n, l) => n + l.qty, 0),
  baseline + 8,
);
({ state: s } = await post({
  type: "pack",
  order: id,
  qty: 5,
  productBarcode,
  material: "Carton",
  dimensions: "20 x 15 x 10",
  weight: 1.2,
}));
({ state: s } = await post({
  type: "dispatch",
  order: id,
  qty: 5,
  courier: "Acceptance carrier",
  tracking: "HTTP-TRACK",
}));
assert.equal(
  s.lots.reduce((n, l) => n + l.qty, 0),
  baseline + 3,
);
await post(
  {
    type: "dispatch",
    order: id,
    qty: 5,
    courier: "Duplicate",
    tracking: "Duplicate",
  },
  "admin",
  400,
);
({ state: s } = await post({
  type: "delivery",
  order: id,
  delivery: "Delivered",
}));
({ state: s } = await post({
  type: "return",
  order: id,
  qty: 1,
  disposition: "Restock",
  batch: "HTTP-RETURN",
  expiry: "2029-01-01",
  reason: "Unopened",
}));
assert.equal(s.lots.at(-1).location, "RECEIVING");
await post(
  { type: "order", customer: "Forbidden", product, qty: 1, warehouse },
  "viewer",
  400,
);
({ state: s } = await post({
  type: "request",
  kind: "Cycle count",
  lot: countLot.id,
  qty: 39,
  reason: "HTTP count",
}));
const req = s.approvals.at(-1).id;
await post(
  { type: "approve", request: req, decision: "Approve", reason: "Self" },
  "admin",
  400,
);
({ state: s } = await post(
  { type: "approve", request: req, decision: "Approve", reason: "Reviewed" },
  "supervisor",
));
assert.equal(s.lots.find((l) => l.id === countLot.id).qty, 39);
await post({ type: "connector", system: "ERP", enabled: true });
const key = "HTTP-" + Date.now(),
  event = {
    type: "import",
    system: "ERP",
    key,
    payload: {
      entity: "Sales order",
      customer: "API import",
      product,
      qty: 99999,
      warehouse,
    },
  };
await post(event, "admin", 400);
const read = await fetch(origin + "/api/wms", {
  headers: { Cookie: cookie.admin },
});
s = (await read.json()).state;
assert.equal(s.syncs[0].status, "Failed");
event.payload.qty = 1;
({ state: s } = await post(event));
assert.equal(s.syncs[0].status, "Completed");
assert.equal(s.syncs[0].attempts, 2);
await post(event, "admin", 400);
const testUser = "test-" + Date.now();
await post({
  type: "user",
  id: testUser,
  name: "Temporary evaluator",
  role: "Operator",
});
await post({
  type: "userUpdate",
  id: testUser,
  name: "Updated evaluator",
  role: "Viewer",
  active: "Disabled",
});
await post({ type: "selectUser", id: testUser }, "disabled", 400);
await post(
  {
    type: "userUpdate",
    id: "admin",
    name: "Jordan Miller",
    role: "Viewer",
    active: "Active",
  },
  "admin",
  400,
);
const csrf = await fetch(origin + "/api/wms", {
  method: "POST",
  headers: {
    Cookie: cookie.admin,
    Origin: "http://untrusted.test",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "order", customer: "CSRF", product, qty: 1 }),
});
assert.equal(csrf.status, 403);
await post({ type: "selectUser" }, "admin", 400);
assert.equal((await fetch(origin + "/api/wms", { headers: { Cookie: cookie.admin } })).status, 200);
assert.equal((await fetch(origin)).status, 200);
console.log(
  "HTTP acceptance passed: authentication, role checks, CSRF, receiving → put away → reservation → picking → packing → dispatch, single deduction, delivery, returns, second review, persistence, failure/retry and duplicate integration events.",
);
