// Cobertura do guard de isolamento local (MIG-R2, Gate seção 12). Nenhum teste aqui usa
// credenciais reais nem se conecta a qualquer serviço — só valida a lógica de configuração.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertLocalSupabaseEnvironment } from '../../src/lib/isolation-guard.ts';

const VALID_LOCAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-local-fake',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-local-fake',
};

test('1. configuração local válida não lança e retorna host/porta corretos', () => {
  const result = assertLocalSupabaseEnvironment(VALID_LOCAL_ENV);

  assert.equal(result.hostname, '127.0.0.1');
  assert.equal(result.port, '54321');
  assert.equal(result.url, 'http://127.0.0.1:54321');
});

test('2. ausência da URL obrigatória é rejeitada', () => {
  assert.throws(() => assertLocalSupabaseEnvironment({}), /ausente/);
});

test('3. URL de projeto remoto (Supabase Cloud) é rejeitada', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: 'https://abcxyzcompany.supabase.co',
      }),
    /Hostname remoto bloqueado/
  );
});

test('4. hostname externo arbitrário é rejeitado', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: 'http://example.com:54321',
      }),
    /Hostname remoto bloqueado/
  );
});

test('5. configuração malformada (URL inválida) é rejeitada', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: 'nao-e-uma-url',
      }),
    /malformada/
  );
});

test('6. credencial privilegiada em variável pública é rejeitada', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'vazou-para-o-navegador',
      }),
    /Credencial privilegiada exposta/
  );
});

test('7. conflito entre variáveis de ambiente (SUPABASE_URL diverge) é rejeitado', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        SUPABASE_URL: 'http://localhost:54321',
      }),
    /Conflito entre variáveis de ambiente/
  );
});

test('7b. configuração de projeto remoto vinculado (supabase link/login) é rejeitada mesmo com URL local', () => {
  assert.throws(
    () =>
      assertLocalSupabaseEnvironment({
        ...VALID_LOCAL_ENV,
        SUPABASE_ACCESS_TOKEN: 'sbp_fake_token',
      }),
    /Configuração de projeto remoto detectada/
  );
});

test('8. ausência de fallback remoto: URL vazia nunca é tratada como "usar o padrão"', () => {
  assert.throws(
    () => assertLocalSupabaseEnvironment({ ...VALID_LOCAL_ENV, NEXT_PUBLIC_SUPABASE_URL: '   ' }),
    /ausente/
  );
});

test('9. execução deste teste não depende de nenhuma credencial real', () => {
  assert.equal(process.env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

test('10. inicialização segura do ambiente local é idempotente', () => {
  const first = assertLocalSupabaseEnvironment(VALID_LOCAL_ENV);
  const second = assertLocalSupabaseEnvironment(VALID_LOCAL_ENV);

  assert.deepEqual(first, second);
  assert.throws(() => {
    // @ts-expect-error -- o retorno deve ser congelado (Object.freeze), mutação é bloqueada.
    first.hostname = 'outro-host';
  });
});
