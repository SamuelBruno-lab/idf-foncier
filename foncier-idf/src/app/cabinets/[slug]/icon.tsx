/**
 * Favicon dynamique par cabinet.
 *
 * Next.js sert prioritairement `src/app/favicon.ico` (triangle par défaut)
 * pour toutes les routes. Ce fichier `icon.tsx` dans le segment
 * `cabinets/[slug]/` override ce comportement et sert le bon PNG
 * selon le slug (Collabimo, Eurealimmo, etc.).
 *
 * Convention Next.js :
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons#generate-icons-using-code-js-ts-tsx
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Map slug → nom du fichier PNG dans /public/
const FAVICON_BY_SLUG: Record<string, string> = {
  collabimo: "collabimo-favicon.png",
  // eurealimmo: "eurealimmo-favicon.png", // ajouter quand le PNG sera dans /public/
};

export default async function Icon({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const filename = FAVICON_BY_SLUG[slug.toLowerCase()];

  if (!filename) {
    // Pas de favicon custom pour ce cabinet → retourne un 1x1 transparent
    // (mieux que le triangle Vercel par défaut)
    const transparent = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    return new Response(new Uint8Array(transparent), {
      headers: { "Content-Type": "image/png" },
    });
  }

  const filepath = path.join(process.cwd(), "public", filename);
  const buffer = await readFile(filepath);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
