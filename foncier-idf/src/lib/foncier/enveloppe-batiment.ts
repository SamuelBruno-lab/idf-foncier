/**
 * Batiment fantome -- module pur, aucun acces DB. Calcule le plus grand
 * rectangle inscriptible dans un polygone (l'enveloppe constructible d'une
 * parcelle, cf. compute_buildable_envelope, sql/76) -- le "positionnement"
 * concret d'un batiment hypothetique, pas juste une surface abstraite.
 *
 * HEURISTIQUE, PAS UN SOLVEUR EXACT : le probleme du plus grand rectangle
 * inscrit dans un polygone quelconque n'a pas de solution fermee simple.
 * L'approche ici (angles candidats = orientations des cotes du polygone,
 * recherche par grille de centres, extension par rayons cardinaux puis
 * verification/retrecissement des 4 coins) donne un resultat realiste pour
 * une visualisation de faisabilite -- PAS un optimum architectural
 * certifie. Valide sur un rectangle simple (100% de l'aire recuperee) et
 * une forme en L (borne correctement a un seul bras).
 */

export type Point = [number, number];

export type RectangleInscrit = {
  /** 4 coins, sens direct, coordonnees dans le meme repere que le polygone d'entree. */
  corners: Point[];
  largeurM: number;
  hauteurM: number;
  aireM2: number;
  /** Orientation du rectangle, en degres (0-180). */
  angleDeg: number;
};

function centroid(poly: Point[]): Point {
  const n = poly.length;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of poly) {
    sx += x;
    sy += y;
  }
  return [sx / n, sy / n];
}

function rotatePoint(pt: Point, angleRad: number, origin: Point): Point {
  const [ox, oy] = origin;
  const x = pt[0] - ox;
  const y = pt[1] - oy;
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  return [x * ca - y * sa + ox, x * sa + y * ca + oy];
}

/** Ray casting standard -- polygone simple (un seul anneau), pas de trous. */
function pointInPolygon(pt: Point, poly: Point[]): boolean {
  const [x, y] = pt;
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Distance depuis `origin` le long de `direction` jusqu'au bord du polygone (rayon). */
function rayDistanceToBoundary(
  origin: Point,
  direction: Point,
  poly: Point[],
  maxDist: number
): number {
  const [cx, cy] = origin;
  const [dx, dy] = direction;
  let best = maxDist;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const A11 = dx;
    const A12 = -ex;
    const A21 = dy;
    const A22 = -ey;
    const det = A11 * A22 - A12 * A21;
    if (Math.abs(det) < 1e-12) continue;
    const b1 = x1 - cx;
    const b2 = y1 - cy;
    const t = (b1 * A22 - A12 * b2) / det;
    const s = (A11 * b2 - b1 * A21) / det;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) {
      if (t < best) best = t;
    }
  }
  return best;
}

function candidateAngles(poly: Point[]): number[] {
  const angles = new Set<number>([0]);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const a = ((Math.atan2(y2 - y1, x2 - x1) % Math.PI) + Math.PI) % Math.PI;
    angles.add(Math.round(a * 1000) / 1000);
  }
  return Array.from(angles);
}

/**
 * @param poly Anneau exterieur du polygone (un seul ring, sens quelconque),
 *   coordonnees metriques (ex: Lambert-93/2154 -- PAS des degres WGS84).
 * @param grid Resolution de la grille de centres candidats par axe (defaut 15).
 */
export function computeLargestInscribedRectangle(
  poly: Point[],
  grid = 15
): RectangleInscrit | null {
  if (poly.length < 3) return null;

  const origin = centroid(poly);
  let best: RectangleInscrit | null = null;

  for (const angle of candidateAngles(poly)) {
    const rotated = poly.map((p) => rotatePoint(p, -angle, origin));
    const xs = rotated.map((p) => p[0]);
    const ys = rotated.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const maxDist = Math.max(maxX - minX, maxY - minY) * 2 + 1;

    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const px = minX + ((i + 0.5) / grid) * (maxX - minX);
        const py = minY + ((j + 0.5) / grid) * (maxY - minY);
        if (!pointInPolygon([px, py], rotated)) continue;

        const right = rayDistanceToBoundary([px, py], [1, 0], rotated, maxDist);
        const left = rayDistanceToBoundary([px, py], [-1, 0], rotated, maxDist);
        const up = rayDistanceToBoundary([px, py], [0, 1], rotated, maxDist);
        const down = rayDistanceToBoundary([px, py], [0, -1], rotated, maxDist);

        // Les 4 rayons cardinaux peuvent surestimer un rectangle valide si
        // un bord du polygone coupe un coin sans toucher les rayons eux-memes
        // (cas concave) -- verification + retrecissement par bissection sur
        // un facteur d'echelle commun aux 4 extensions.
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          const corners: Point[] = [
            [px - left * mid, py - down * mid],
            [px + right * mid, py - down * mid],
            [px + right * mid, py + up * mid],
            [px - left * mid, py + up * mid],
          ];
          if (corners.every((c) => pointInPolygon(c, rotated))) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const scale = lo;
        const largeurM = (left + right) * scale;
        const hauteurM = (up + down) * scale;
        const aireM2 = largeurM * hauteurM;

        if (aireM2 > 0 && (!best || aireM2 > best.aireM2)) {
          const cornersRotated: Point[] = [
            [px - left * scale, py - down * scale],
            [px + right * scale, py - down * scale],
            [px + right * scale, py + up * scale],
            [px - left * scale, py + up * scale],
          ];
          const corners = cornersRotated.map((c) => rotatePoint(c, angle, origin));
          best = {
            corners,
            largeurM,
            hauteurM,
            aireM2,
            angleDeg: (angle * 180) / Math.PI,
          };
        }
      }
    }
  }

  return best;
}

/** Extrait le plus grand anneau exterieur d'une geometrie GeoJSON (Polygon ou
 * MultiPolygon) -- l'enveloppe constructible peut se fragmenter en plusieurs
 * morceaux disjoints (parcelle tres contrainte) ; on ne travaille que sur le
 * plus grand, limite documentee. */
export function extractLargestRing(geojson: {
  type: string;
  coordinates: unknown;
}): Point[] | null {
  const aireRing = (ring: Point[]): number => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };

  if (geojson.type === "Polygon") {
    const rings = geojson.coordinates as Point[][];
    return rings[0] ?? null;
  }
  if (geojson.type === "MultiPolygon") {
    const polys = geojson.coordinates as Point[][][];
    let bestRing: Point[] | null = null;
    let bestArea = -1;
    for (const p of polys) {
      const ring = p[0];
      if (!ring) continue;
      const a = aireRing(ring);
      if (a > bestArea) {
        bestArea = a;
        bestRing = ring;
      }
    }
    return bestRing;
  }
  return null;
}
