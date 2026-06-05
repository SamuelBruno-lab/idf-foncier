import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Assure que le template Word des contrats est embarqué dans les fonctions
  // serverless (Vercel) qui le lisent via fs — sinon ENOENT en prod.
  outputFileTracingIncludes: {
    "/api/cabinets/**": ["./public/legal/templates/**"],
    "/api/mandataire/**": ["./public/legal/templates/**"],
  },
};

export default nextConfig;
