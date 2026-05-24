/**
 * Point-in-polygon via ray casting (algorithme classique, O(n)).
 *
 * Convention dans dvf_hdbscan_zones.hull_coords : tableau [[lat, lon], ...]
 * fermé (premier point = dernier). On reste cohérent : le point candidat
 * est aussi [lat, lon].
 */
export function pointInPolygon(
  point: [number, number],
  polygon: number[][],
): boolean {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] as [number, number];
    const [xj, yj] = polygon[j] as [number, number];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Distance Haversine en mètres entre deux points (lat, lon).
 * Utile pour départager 2 clusters voisins si le point est en bordure.
 */
export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
