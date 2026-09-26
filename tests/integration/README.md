# tests/integration

Testes que dependem do Supabase local (Docker). Nunca devem apontar para um projeto Supabase
remoto — o guard de isolamento em `src/lib/isolation-guard.ts` é chamado antes de cada execução.
