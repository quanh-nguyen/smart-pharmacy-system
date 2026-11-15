const ROUTING_BASE = "https://router.project-osrm.org";

function isNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function coordinates(point) {
  return `${Number(point.lon)},${Number(point.lat)}`;
}

// Keep requests bounded and never substitute straight-line estimates for road distances.
export async function fetchRoadDistances(origin, pharmacies) {
  const result = pharmacies.map((pharmacy) => ({ ...pharmacy, roadStatus: "unavailable" }));
  const chunks = [];
  for (let offset = 0; offset < pharmacies.length; offset += 40) chunks.push(offset);
  async function worker() {
    while (chunks.length) {
      const offset = chunks.shift();
      const batch = pharmacies.slice(offset, offset + 40);
      const points = [origin, ...batch].map(coordinates).join(";");
      const destinations = batch.map((_, index) => index + 1).join(";");
      try {
        const response = await fetch(`${ROUTING_BASE}/table/v1/driving/${points}?sources=0&destinations=${destinations}&annotations=distance,duration`, {
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.code !== "Ok") continue;
        batch.forEach((_, index) => {
          const distance = data.distances?.[0]?.[index];
          const duration = data.durations?.[0]?.[index];
          if (isNonnegativeNumber(distance) && isNonnegativeNumber(duration)) {
            Object.assign(result[offset + index], {
              roadStatus: "ready", roadDistanceKm: distance / 1000,
              roadDurationMinutes: Math.max(1, Math.round(duration / 60)),
            });
          } else if (distance === null) {
            result[offset + index].roadStatus = "no-route";
          }
        });
      } catch { /* Keep unavailable routes explicit; other batches can still succeed. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  return result.sort((a, b) => (a.roadDistanceKm ?? Infinity) - (b.roadDistanceKm ?? Infinity));
}

export async function fetchRoadRoute(origin, destination) {
  const response = await fetch(`${ROUTING_BASE}/route/v1/driving/${coordinates(origin)};${coordinates(destination)}?overview=full&geometries=geojson`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Không lấy được tuyến đường. Hãy thử lại sau.");
  const data = await response.json();
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.geometry || !isNonnegativeNumber(route.distance) || !isNonnegativeNumber(route.duration)) {
    throw new Error("Không tìm thấy tuyến đường bộ đến nhà thuốc này.");
  }
  return route;
}
