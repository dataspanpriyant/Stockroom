import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mapCss = fs.readFileSync(new URL("../components/dashboard-warehouse-map.module.css", import.meta.url), "utf8");
const mapTsx = fs.readFileSync(new URL("../components/dashboard-warehouse-map.tsx", import.meta.url), "utf8");
const dashboardTsx = fs.readFileSync(new URL("../components/warehouse-dashboard.tsx", import.meta.url), "utf8");

test("Dashboard map uses named template values", () => {
  assert.doesNotMatch(mapCss, /#[0-9a-fA-F]{3,8}|rgb\(/);
  assert.doesNotMatch(mapCss, /font-size:\s*\d+px/);
  assert.doesNotMatch(mapTsx, /style=\{\{[^}]*\b(?:color|fontSize)\b/s);
  const dashboard = dashboardTsx.slice(dashboardTsx.indexOf('if (active === "Dashboard")'), dashboardTsx.indexOf('else if (active === "Receiving")'));
  assert.doesNotMatch(dashboard, /#[0-9a-fA-F]{3,8}|rgb\(/);
  assert.doesNotMatch(dashboard, /style=\{\{[^}]*\b(?:color|fontSize)\b/s);
});
