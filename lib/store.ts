import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  seed,
  execute,
  cleanupZeroQuantityLots,
  type State,
  type Command,
  type User,
  type Role,
} from "./wms";
const root = process.env.WMS_DATA_DIR || path.join(process.cwd(), "data");
const file = path.join(root, "warehouse.json");
export function save(s: State) {
  fs.mkdirSync(root, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}
export function load(): State {
  if (!fs.existsSync(file)) {
    const s = seed();
    s.users = [
      {
        id: "admin",
        name: "Jordan Miller",
        role: "Admin",
        password: "",
        active: true,
      },
      {
        id: "supervisor",
        name: "Morgan Lee",
        role: "Supervisor",
        password: "",
        active: true,
      },
      {
        id: "operator",
        name: "Alex Chen",
        role: "Operator",
        password: "",
        active: true,
      },
      {
        id: "viewer",
        name: "Sam Taylor",
        role: "Viewer",
        password: "",
        active: true,
      },
    ];
    save(s);
  }
  const state: State = JSON.parse(fs.readFileSync(file, "utf8"));
  state.stores ||= [
    { id: "STORE-01", name: "Northstar Central" },
    { id: "STORE-02", name: "Northstar South" },
  ];
  state.transfers ||= [];
  state.receivingSessions ||= [];
  state.sampleProducts ||= seed().sampleProducts;
  for (const product of state.products) {
    product.unit ||= "unit";
    product.productType ||= "Non-perishable";
    product.expiryTracking ??= true;
    product.serialTracking ??= false;
  }
  state.purchaseOrders ||= [];
  for (const purchaseOrder of state.purchaseOrders) {
    purchaseOrder.status ||= "Sent";
    purchaseOrder.receivedQty ||= 0;
  }
  for (const receipt of state.receipts) {
    receipt.warehouse ||= state.warehouses[0]?.id || "";
    receipt.receivingLocation ||= "RECEIVING";
  }
  for (const order of state.orders) {
    order.orderType ||= "Customer Order";
    order.lines ||= [{ product: order.product, qty: order.qty, picked: order.picked, packed: order.status === "Packed" || order.status === "Dispatched" ? order.picked : 0 }];
    for (const allocation of order.allocations) allocation.product ||= order.product;
  }
  const cleanup = cleanupZeroQuantityLots(state);
  if (cleanup.removed.length) save(state);
  return state;
}
export function publicState(s: State) {
  return { ...s, users: s.users.map(({ password: _, ...u }) => u) };
}
export function transact(c: Command, user: User) {
  const s = load();
  if (c.type === "userUpdate") {
    if (user.role !== "Admin") throw Error("Admin access required");
    const row = s.users.find((u) => u.id === c.id);
    if (!row) throw Error("User not found");
    const role = String(c.role) as Role;
    const name = String(c.name || "").trim();
    const active = c.active === "Active";
    if (!name || !["Admin", "Supervisor", "Operator", "Viewer"].includes(role))
      throw Error("Valid name and role required");
    if (row.id === user.id && (role !== "Admin" || !active))
      throw Error("You cannot revoke your own admin access");
    if (
      s.orders.some((o) => o.assignee === row.id && o.status === "Reserved") &&
      (!active || role === "Viewer")
    )
      throw Error("Reassign outstanding picking tasks first");
    Object.assign(row, {
      name,
      role,
      active,
    });
    s.events.unshift({
      id: randomBytes(8).toString("hex"),
      at: new Date().toISOString(),
      actor: user.id,
      action: "userUpdate",
      reference: row.id,
      detail: "Updated staff name, role or account status",
    });
    save(s);

    return s;
  }
  if (c.type === "user") {
    if (user.role !== "Admin") throw Error("Admin access required");
    const id = String(c.id || "").trim(),
      name = String(c.name || "").trim(),
      role = String(c.role) as Role;
    if (
      !id ||
      !name ||
      !["Admin", "Supervisor", "Operator", "Viewer"].includes(role)
    )
      throw Error("Valid ID, name and role are required");
    if (s.users.some((u) => u.id === id)) throw Error("User ID already exists");
    s.users.push({ id, name, role, password: "", active: true });
    s.events.unshift({
      id: randomBytes(8).toString("hex"),
      at: new Date().toISOString(),
      actor: user.id,
      action: "user",
      reference: id,
      detail: `Created ${role} user ${name}`,
    });
    save(s);
    return s;
  }
  try {
    const next = execute(s, c, user);
    save(next);
    return next;
  } catch (error) {
    if (c.type === "import" && user.role === "Admin") {
      s.syncs.unshift({
        id: randomBytes(8).toString("hex"),
        system: String(c.system || ""),
        key: String(c.key || ""),
        status: "Failed",
        detail: error instanceof Error ? error.message : "Import failed",
        at: new Date().toISOString(),
        attempts:
          (s.syncs.find((x) => x.system === c.system && x.key === c.key)
            ?.attempts || 0) + 1,
      });
      save(s);
    }
    throw error;
  }
}
export function sessions() {
  const p = path.join(root, "sessions.json");
  return {
    read: () => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, { user: string; expires: number }> : {},
    write: (v: Record<string, { user: string; expires: number }>) => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); },
  };
}
