// Guard de isolamento local (MIG-R2). Impede que a aplicação, o build ou os testes de
// integração se conectem, mesmo por acidente, a um projeto Supabase remoto.
//
// Regras: falha fechado. Ausência de configuração NUNCA cai em um valor padrão remoto — a
// ausência de fallback é o próprio comportamento seguro, não uma lacuna a preencher depois.
//
// Limitação conhecida (registrar, não presumir resolvida): validar a URL configurada prova que
// a aplicação NÃO FOI CONFIGURADA para apontar a um destino remoto. Isso não prova que nenhuma
// biblioteca de terceiros, SDK ou dependência transitiva possa abrir sua própria conexão de
// rede para outro destino. Este guard cobre configuração, não runtime de rede completo.

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);

// Nomes de variável que, se expostos com o prefixo público do Next.js, vazam uma credencial
// privilegiada para o navegador — mesmo em desenvolvimento local.
const PRIVILEGED_NAME_PATTERN = /SERVICE_ROLE|SECRET|PRIVATE_KEY|ADMIN_KEY|DB_PASSWORD/i;

// Presença de qualquer uma indica CLI autenticado ou projeto vinculado (`supabase login` /
// `supabase link`), mesmo que a URL configurada aponte para localhost.
const REMOTE_PROJECT_MARKERS = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD'];

export interface LocalSupabaseEnvironment {
  readonly url: string;
  readonly hostname: string;
  readonly port: string;
}

// Tipo próprio (não NodeJS.ProcessEnv): este guard não depende do shape específico que o
// Next.js injeta em process.env (ex.: NODE_ENV obrigatório), só de um mapa de string a string.
type EnvMap = Record<string, string | undefined>;

export function assertLocalSupabaseEnvironment(env: EnvMap = process.env): LocalSupabaseEnvironment {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;

  if (!raw || !raw.trim()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: nenhum fallback remoto é permitido.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL malformada: "${raw}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Protocolo não suportado em NEXT_PUBLIC_SUPABASE_URL: "${parsed.protocol}".`);
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Hostname remoto bloqueado: "${parsed.hostname}". Apenas localhost/127.0.0.1 são aceitos.`
    );
  }

  if (!parsed.port) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL sem porta explícita: configuração local exige porta.');
  }

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('NEXT_PUBLIC_') && PRIVILEGED_NAME_PATTERN.test(key) && value?.trim()) {
      throw new Error(`Credencial privilegiada exposta em variável pública: "${key}".`);
    }
  }

  for (const marker of REMOTE_PROJECT_MARKERS) {
    if (env[marker]?.trim()) {
      throw new Error(`Configuração de projeto remoto detectada em "${marker}": não permitido.`);
    }
  }

  const alternateUrl = env.SUPABASE_URL?.trim();
  if (alternateUrl) {
    let alternateHost: string;
    try {
      alternateHost = new URL(alternateUrl).hostname;
    } catch {
      throw new Error(`SUPABASE_URL malformada: "${alternateUrl}".`);
    }
    if (alternateHost !== parsed.hostname) {
      throw new Error(
        `Conflito entre variáveis de ambiente: NEXT_PUBLIC_SUPABASE_URL ("${parsed.hostname}") ` +
          `difere de SUPABASE_URL ("${alternateHost}").`
      );
    }
  }

  return Object.freeze({ url: raw, hostname: parsed.hostname, port: parsed.port });
}
