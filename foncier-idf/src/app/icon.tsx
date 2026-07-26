/**
 * Favicon ROOT dynamique — dispatch selon le hostname.
 *
 * Next.js sert automatiquement ce fichier à /icon (+ inclut le lien HTML
 * `<link rel="icon">` dans <head>). Contrairement à `favicon.ico` (statique,
 * priorité absolue), ce fichier est un handler dynamique.
 *
 * Le hostname permet de servir des favicons différents selon le domaine :
 *   - estimer.collabimo.com  → logo Collabimo
 *   - app.eurealimmo.com     → (à ajouter quand PNG dans /public/)
 *   - datamerry.com          → favicon Datamerry par défaut (à créer)
 *
 * Doc Next.js :
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons#generate-icons-using-code-js-ts-tsx
 */

import { headers } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Map hostname → nom du fichier PNG dans /public/
const FAVICON_BY_HOST: Record<string, string> = {
  "estimer.collabimo.com": "collabimo-favicon.png",
  "www.collabimo.com": "collabimo-favicon.png",
  // "app.eurealimmo.com": "eurealimmo-favicon.png",  // à ajouter
  // "datamerry.com": "datamerry-favicon.png",
};

// 1×1 PNG transparent en base64 — servi si aucun favicon custom trouvé
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export default async function Icon() {
  const h = await headers();
  const host = (h.get("host") ?? "").toLowerCase();
  const filename = FAVICON_BY_HOST[host];

  if (!filename) {
    return new Response(new Uint8Array(TRANSPARENT_PNG), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  try {
    const filepath = path.join(process.cwd(), "public", filename);
    const buffer = await readFile(filepath);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response(new Uint8Array(TRANSPARENT_PNG), {
      headers: { "Content-Type": "image/png" },
    });
  }
}
