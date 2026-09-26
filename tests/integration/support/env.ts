// Bootstrap obrigatório dos testes de integração (Supabase local via Docker). Qualquer teste de
// integração futuro deve importar este módulo antes de qualquer chamada de rede: o guard falha
// fechado se o ambiente não apontar, comprovadamente, para o Supabase local.
//
// MIG-R2 não habilita nenhum teste de integração real (ver docs/mig-r2-fundacao.md) — este
// arquivo prepara o ponto de chamada exigido pelo Gate para os próximos Gates.
import { assertLocalSupabaseEnvironment } from "../../../src/lib/isolation-guard.ts";

export const localSupabaseEnvironment = assertLocalSupabaseEnvironment();
