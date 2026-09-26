import type { NextConfig } from "next";

import { assertLocalSupabaseEnvironment } from "./src/lib/isolation-guard";

// Falha fechado antes de `next dev` ou `next build` prosseguirem: nenhum dos dois deve iniciar
// se o ambiente não apontar, comprovadamente, para o Supabase local.
assertLocalSupabaseEnvironment();

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
