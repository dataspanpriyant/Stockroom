import { locationPosition, lotWarehouse, storageOccupancy, storageTone, type Location, type Lot, type State, type StorageOccupancy } from "./wms.ts";

export type DashboardMapCell = {
  location: Location;
  label: string;
  path: string;
  occupancy: StorageOccupancy;
  status: string;
  lots: Lot[];
};
export type DashboardMapRow = { id: string; label: string; cells: DashboardMapCell[]; occupancy: StorageOccupancy };
export type DashboardMapRack = { id: string; rows: DashboardMapRow[]; occupancy: StorageOccupancy };
export type DashboardMapZone = { id: string; racks: DashboardMapRack[]; occupancy: StorageOccupancy };
export type DashboardMapSpecial = { receiving: number; quarantine: number };
export type DashboardMapWarehouse = {
  id: string;
  name: string;
  zones: DashboardMapZone[];
  legacy: DashboardMapCell[];
  special: DashboardMapSpecial;
  occupancy: StorageOccupancy;
};

const empty = (): StorageOccupancy => ({ capacity: 0, occupied: 0, available: 0, excess: 0 });
function add(left: StorageOccupancy, right: StorageOccupancy): StorageOccupancy {
  return { capacity: left.capacity + right.capacity, occupied: left.occupied + right.occupied, available: left.available + right.available, excess: left.excess + right.excess };
}
function compare(left: string, right: string) { return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }); }
export function displayLocationName(location: Location) {
  const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
  if (location.name && location.name !== location.id) return decode(location.name);
  return decode(location.id.split("/").at(-1) || location.id);
}
export function dashboardLocationPath(location: Location) {
  const position = locationPosition(location);
  return [location.warehouse, position.zone, position.rack, position.section, `R${position.row}C${position.column}${position.shelf > 1 ? `/${position.shelf}` : ""}`].map((part) => decodeURIComponent(String(part))).join(" / ");
}
function isQuarantine(location: Location) { return (location.zone || "").toUpperCase() === "QUARANTINE"; }
function cell(state: Pick<State, "lots">, location: Location, occupancy: StorageOccupancy): DashboardMapCell {
  return { location, label: displayLocationName(location), path: dashboardLocationPath(location), occupancy, status: storageTone(occupancy), lots: state.lots.filter((lot) => lot.location === location.id && lot.qty > 0) };
}

export function groupDashboardLocations(state: Pick<State, "locations" | "lots" | "receipts" | "warehouses">): DashboardMapWarehouse[] {
  const occupancy = storageOccupancy({ locations: state.locations.filter((location) => !isQuarantine(location)), lots: state.lots });
  return state.warehouses.map((warehouse) => {
    const warehouseLocations = state.locations.filter((location) => location.warehouse === warehouse.id);
    const regular = warehouseLocations.filter((location) => !isQuarantine(location));
    const legacy = regular.filter((location) => !location.zone && !location.rack).map((location: Location) => cell(state, location, occupancy.unit(location.id) || empty()));
    const grouped = new Map<string, Map<string, Map<number, Location[]>>>();
    for (const location of regular.filter((item) => item.zone && item.rack)) {
      const position = locationPosition(location);
      const racks = grouped.get(position.zone) || new Map<string, Map<number, Location[]>>();
      grouped.set(position.zone, racks);
      const rows = racks.get(position.rack) || new Map<number, Location[]>();
      racks.set(position.rack, rows);
      const units = rows.get(position.row) || [];
      units.push(location);
      rows.set(position.row, units);
    }
    const zones = [...grouped.entries()].sort((a, b) => compare(a[0], b[0])).map(([zoneId, racks]) => {
      const zoneRacks = [...racks.entries()].sort((a, b) => compare(a[0], b[0])).map(([rackId, rows]) => {
        const rackRows = [...rows.entries()].sort(([a], [b]) => a - b).map(([rowNumber, locations]) => {
          const cells = locations.sort((a, b) => locationPosition(a).column - locationPosition(b).column || locationPosition(a).shelf - locationPosition(b).shelf)
            .map((location: Location) => cell(state, location, occupancy.unit(location.id) || empty()));
          return { id: `${rackId}-${rowNumber}`, label: `Row ${rowNumber}`, cells, occupancy: cells.reduce((sum, item) => add(sum, item.occupancy), empty()) };
        });
        return { id: rackId, rows: rackRows, occupancy: rackRows.reduce((sum, item) => add(sum, item.occupancy), empty()) };
      });
      return { id: zoneId, racks: zoneRacks, occupancy: zoneRacks.reduce((sum, item) => add(sum, item.occupancy), empty()) };
    });
    const quarantine = warehouseLocations.filter(isQuarantine).reduce((sum, location) => sum + state.lots.filter((lot) => lot.location === location.id).reduce((total, lot) => total + lot.qty, 0), 0);
    const receiving = state.lots.filter((lot) => lot.location === "RECEIVING" && lot.qty > 0 && lotWarehouse(state, lot) === warehouse.id).reduce((sum, lot) => sum + lot.qty, 0);
    const warehouseCells = zones.flatMap((zone) => zone.racks.flatMap((rack) => rack.rows.flatMap((row) => row.cells))).concat(legacy);
    return { id: warehouse.id, name: warehouse.name, zones, legacy, special: { receiving, quarantine }, occupancy: warehouseCells.reduce((sum, item) => add(sum, item.occupancy), empty()) };
  });
}
