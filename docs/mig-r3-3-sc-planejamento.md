# MIG-R3.3-SC-P-R — Retificação do planejamento de segurança (Supabase local)

Gate de **retificação documental**. Não autoriza implementação. Nenhuma credencial foi trocada,
nenhum serviço foi reiniciado, nenhum arquivo além deste foi alterado, nada foi publicado. Este
documento substitui o conteúdo do MIG-R3.3-SC-P original à luz do REPORT MIG-R3.3-SC-V (entregue
na conversa do Claude Code, não commitado como arquivo), do REPORT da **retomada** do MIG-R3.3-S
(também entregue só na conversa, não commitado como arquivo — ver §1) e do REPORT MIG-R3.3-S
(commitado, `docs/mig-r3-3-seguranca-local.md`, reflete o estado anterior a essa retomada). MIG-R3.3
(implementação), UX-0 e MIG-R4 não foram iniciados.

## 0. Estado do Git

| | Início | Fim |
| --- | --- | --- |
| Branch | `security/mig-r3-3-local-admin` | `security/mig-r3-3-local-admin` (sem alteração) |
| HEAD | `9f2f150` | `9f2f150` (sem alteração) |
| Working tree | 1 arquivo não rastreado (`docs/mig-r3-3-sc-planejamento.md`, este próprio arquivo) | idem |

Nenhum commit foi criado por este Gate. "Working tree limpa" nos REPORTs anteriores refere-se à
ausência de alterações **inesperadas** em arquivos alheios ao escopo do Gate — não à inexistência
do artefato que o próprio Gate produz. Este arquivo permanece não rastreado até decisão do usuário
sobre commit, conforme a autorização permanente de Git registrada em memória do projeto. Nenhuma
divergência de Git foi encontrada além dessa, já esperada.

## 1. Por que este Gate existe

**Correção de cronologia**, `COMPROVADO_PELO_REPORT` (informação fornecida diretamente pelo
usuário/orquestrador nesta rodada, não reconstruída por leitura de arquivo deste repositório — não
há um arquivo separado de "retomada" commitado): o MIG-R3.3-S fechou, na configuração hoje
commitada (`docs/mig-r3-3-seguranca-local.md`), `/pg/query`, `/mcp` e `/rest-admin/v1`, desligando
`[studio]`, `[api]` e `[analytics]`. Foi a **retomada** desse mesmo Gate MIG-R3.3-S que identificou
a exposição da Auth Admin API — a chave `service_role` de demonstração, pública e universal em
qualquer instalação padrão da CLI Supabase, concedendo acesso total a `/auth/v1/admin/*` — e foi
esse achado, feito durante a retomada, que encerrou o MIG-R3.3-S como **BLOCKED**. O texto do
arquivo commitado hoje disponível (§2.4, que classifica `/auth/v1/admin/*` como "não
administrativo-aberto" testando sem Bearer válido) reflete um estado anterior a essa retomada, não
o achado que motivou o BLOCKED — não há contradição real, são dois momentos do mesmo Gate. O
MIG-R3.3-SC-P, em seguida, **acrescentou** a esse achado já conhecido a prova por navegador real
(Playwright, origem distinta) do mesmo vetor. O MIG-R3.3-SC-V (verificação) encontrou que várias
conclusões do SC-P precisavam de correção — algumas por terem tratado hipóteses como fatos, uma por
conter um erro de leitura de catálogo. Este documento retifica essas conclusões. Nenhuma correção
do risco em si foi aplicada por nenhum dos Gates até aqui.

## 2. Legenda de classificação de evidências

Toda afirmação técnica relevante abaixo carrega um destes rótulos:

| Rótulo | Significado |
| --- | --- |
| `COMPROVADO_PELO_REPORT` | resultado relatado por um agente executor nesta ou em Gate anterior, com evidência específica |
| `INSPECAO_READ_ONLY` | verificado por leitura direta neste Gate (arquivo, catálogo, config) |
| `DOCUMENTACAO_OFICIAL` | respaldado por documentação pública, com versão/alcance identificados |
| `ENGENHARIA_REVERSA` | comportamento inferido do binário instalado, sem garantia de estabilidade entre versões |
| `INFERENCIA_TECNICA` | conclusão derivada de fatos comprovados, mas não demonstrada diretamente |
| `HIPOTESE_NAO_TESTADA` | possibilidade que ainda exige comprovação empírica |
| `PROPOSTO_NAO_IMPLEMENTADO` | solução ou teste desenhado para um Gate futuro, não aplicado |
| `DECISAO_PENDENTE` | questão que exige autorização explícita do usuário |
| `NAO_DETERMINADA` | causa ou estado não investigado o suficiente para conclusão |

## 3. Correções obrigatórias incorporadas do SC-V

### 3.1 Chave ES256 do Auth local

- `ENGENHARIA_REVERSA`: no binário instalado da CLI 2.118.0 para Windows x64
  (`node_modules/@supabase/cli-windows-x64/bin/supabase.exe`), aparece um literal de chave EC
  P-256 (kid `b81269f1-21d8-4f2e-b719-c2240a840d90`), sem chamada de geração em runtime associada
  a ele.
- `COMPROVADO_PELO_REPORT` (verificação feita no Gate MIG-R3.3-SC-V, não neste Gate de retificação
  documental, que não executou nova investigação técnica — §11): uma requisição
  `GET /auth/v1/.well-known/jwks.json` contra o stack em execução confirmou que o `kid` e os
  componentes públicos (`x`/`y`) publicados pelo Auth local batem com esse literal. O `kid` e as coordenadas públicas não são segredo (fazem parte do JWKS
  público por definição) — não há necessidade de reproduzi-los para além do necessário à
  verificação (`JWKS-1`/`JWKS-2`, §7).
- `HIPOTESE_NAO_TESTADA`, explicitamente **não comprovada**:
  - que esse literal é o mesmo em qualquer instalação da mesma versão/plataforma (só esta
    instalação foi inspecionada);
  - que o literal se repete em outras versões ou plataformas da CLI;
  - a correspondência matemática entre a parte privada e a pública não foi derivada
    independentemente (seria possível verificar offline, sem assinar nada, mas não foi feito);
  - que um JWT ES256 assinado com essa chave, com `aud=authenticated` e `role=service_role`, é de
    fato aceito pela Auth Admin API. **Nenhum JWT foi forjado ou enviado neste ou no Gate
    anterior** — proibido por escopo em ambos.
- **Não afirmar que a Auth Admin API já foi explorada via ES256.** O que está confirmado é que o
  segredo HS256 de demonstração (não a chave ES256) já concede esse acesso — identificado na
  retomada do MIG-R3.3-S (`COMPROVADO_PELO_REPORT`) e comprovado adicionalmente por navegador real
  (Playwright) pelo MIG-R3.3-SC-P (`COMPROVADO_PELO_REPORT`, entregue na conversa); ver cronologia
  corrigida em §1. A via ES256 é
  `INFERENCIA_TECNICA` relevante — os três
  requisitos que o Admin API verifica (assinatura, `aud`, `role`) são, individualmente,
  satisfazíveis com essa chave, mas isso não é o mesmo que uma exploração demonstrada.
- Correção ao antigo §6 (matriz de testes): a linha "ES256 forjado com chave padrão → deve virar
  401" não pode ser prometida como resultado garantido sem que exista, antes, um mecanismo
  comprovado de desautorizar o `kid` antigo do JWKS (ver §4, alternativa A).

### 3.2 Chaves `sb_secret_*` / `sb_publishable_*`

- `ENGENHARIA_REVERSA`: strings com o mesmo prefixo (`sb_secret_...`, `sb_publishable_...`)
  aparecem como literais no mesmo binário, sem geração em runtime associada.
- `COMPROVADO_PELO_REPORT` (verificação feita no Gate MIG-R3.3-SC-V): os mesmos valores foram
  confirmados em uso no ambiente local atual, por comparação de valor (nunca por impressão em
  texto puro).
- Limitação: `HIPOTESE_NAO_TESTADA` para outras versões/plataformas, mesma ressalva do item 3.1.
- **Distinção obrigatória** entre os quatro tipos de credencial envolvidos, para não tratá-los
  como equivalentes:
  - **Chave publicável** (`sb_publishable_*`): id de projeto/API, não secreta por desenho.
  - **Chave secreta** (`sb_secret_*`): formato novo da API key, equivalente em finalidade ao
    `service_role` legado.
  - **Segredo de assinatura HS256** (`SUPABASE_AUTH_JWT_SECRET`/`GOTRUE_JWT_SECRET`): assina/valida
    tokens `anon`/`service_role` legados e sessões de usuário quando HS256 é usado.
  - **Chave privada ES256** (`GOTRUE_JWT_KEYS`): assina/valida sessões de usuário quando ES256 é
    usado; discutida em 3.1.
- `PROPOSTO_NAO_IMPLEMENTADO`: gerar novas chaves de qualquer um desses quatro tipos, isoladamente,
  **não** é presumido como suficiente para invalidar as demais. Investigar em Gate futuro se a CLI
  expõe algum mecanismo de override para `publishable_key`/`secret_key` em `[auth]` do
  `config.toml` — não confirmado nesta verificação. Se não houver, registrar como pendência
  explícita, não como corrigido.

### 3.3 Segredos compartilhados entre serviços

- `COMPROVADO_PELO_REPORT` (devops-engineer, SC-V): no momento da inspeção, Auth, Storage,
  Realtime e Edge Runtime tinham, por comparação de valor, o mesmo segredo HS256 e o mesmo JWKS.
  Para o Edge Runtime especificamente, dado que o container já estava parado nesse momento (ver
  correção do histórico abaixo), essa comparação é sobre **configuração recebida** (a variável de
  ambiente materializada no container parado, via `docker inspect`/arquivo de secrets), não sobre
  uma credencial sendo aceita por um serviço em execução.
- `INFERENCIA_TECNICA`, não comprovada: que essa igualdade implica que os quatro serviços
  releem a mesma origem e se atualizariam automaticamente após um único `supabase stop`+`start`
  futuro. Isso **não foi testado** (nenhum restart foi executado, proibido em ambos os Gates).
- `HIPOTESE_NAO_TESTADA` registrada pelo revisor independente: o Realtime persiste configuração de
  tenant (incluindo segredo JWT) em `_realtime.tenants`, semeada no primeiro `start`. Um restart
  futuro pode, em tese, deixar esse tenant com o segredo antigo mesmo que a variável de ambiente do
  container mude. Precisa de verificação empírica num Gate de implementação (comparação de
  metadado/hash antes e depois, sem imprimir segredo).
- **Contradição a resolver, não fato assumido**: o SC-P original afirmou, na mesma seção, tanto que
  a chave `oct` do `SUPABASE_JWKS` "permanece" após uma eventual troca do HS256, quanto que essa
  troca invalidaria o segredo antigo em todos os serviços. As duas afirmações não são compatíveis
  sem esclarecer se essa chave `oct` deriva do segredo HS256 (mudaria junto) ou é independente
  (não mudaria, e a propagação não seria completa). `NAO_DETERMINADA` até investigação específica.
- **Correção do histórico do Edge Runtime**: `COMPROVADO_PELO_REPORT`: o container já estava
  **parado na retomada do MIG-R3.3-S**, ou seja, antes do MIG-R3.3-SC-V — não é um estado
  encontrado pela primeira vez na verificação do SC-V, como uma versão anterior deste documento
  afirmava. **Retificação de uma inferência anterior**: este documento chegou a deduzir, a partir
  do `404` registrado em `/functions/v1/* → 404, sem funções` no REPORT commitado do MIG-R3.3-S
  (`docs/mig-r3-3-seguranca-local.md:101-103`), que o container "provavelmente estava de pé" naquele
  momento. Essa dedução está retirada: não há evidência suficiente para afirmar se o container
  estava em execução quando esse `404` foi registrado, nem quando ou por que parou.
  A causa (e o momento) da parada permanecem `NAO_DETERMINADA` — não atribuí-los à ausência de funções em
  `supabase/functions/` (mera correlação observada, não investigada) nem a nenhuma outra hipótese
  sem evidência adicional. Nenhum teste que dependa desse serviço (`EDGE-1`, §7) deve ser executado
  ou interpretado até essa causa ser esclarecida.
- Distinção obrigatória, não colapsar em "seguro"/"inseguro": **configuração recebida** (a
  variável de ambiente presente no container), **credencial efetivamente aceita** (o serviço
  valida a assinatura) e **autorização concedida** (o serviço permite a operação pedida) são três
  fatos diferentes; as evidências do SC-V cobrem principalmente o primeiro e parcialmente o
  segundo (respostas 403 "Invalid Compact JWS"/vazio), não o terceiro para os casos ES256/`sb_*`.

### 3.4 Senha do PostgreSQL local

- **Correção do SC-P original**: a afirmação de que definir `SUPABASE_DB_PASSWORD` "dispararia" o
  guard estava formulada de forma imprecisa. `INSPECAO_READ_ONLY` (`src/lib/isolation-guard.ts:20,
  66-70`): a rejeição ocorre quando a variável está presente no `process.env` do processo que
  `assertLocalSupabaseEnvironment()` inspeciona — hoje, apenas os processos Next.js e de teste
  (chamadas em `next.config.ts:7` e `tests/integration/support/env.ts:9`).
- `ENGENHARIA_REVERSA`, `HIPOTESE_NAO_TESTADA`: uma rotina no binário da CLI parece resolver
  `.env`/`.env.local` a partir da subpasta `supabase/`, caminho fisicamente distinto de onde
  Next.js e os testes carregam variáveis (confirmado por código, `INSPECAO_READ_ONLY`, que ambos
  leem só `.env*` da raiz). Isso sugere — mas **não comprova** — que definir a senha somente em
  `supabase/.env.local` evitaria o guard. Ressalvas registradas pelo revisor independente, todas
  não resolvidas:
  - os nomes de função no binário minificado foram interpretados, não observados em execução;
  - não se descartou que a mesma rotina também leia o `.env.local` da raiz (inverteria a
    conclusão);
  - não se verificou se a senha, já fixada no `initdb` do volume Docker existente, mudaria de fato
    só por variável de ambiente nova, ou se quebraria a conexão da CLI com o volume já criado.
- **Distinção obrigatória entre os dois arquivos `.env.local`, para não confundi-los** —
  `INSPECAO_READ_ONLY`, duas classes de credencial, não uma:
  - **(a) Material de assinatura e configuração da CLI** (`SUPABASE_AUTH_JWT_SECRET`,
    `signing_keys_path`, override de `publishable_key`/`secret_key`, e a hipótese não testada da
    senha do Postgres): fica **exclusivamente** em `supabase/.env.local`, lido só pela CLI
    (processo `supabase start`, fora do runtime da aplicação), se algum Gate futuro vier a
    defini-lo. Nunca no `.env.local` da raiz.
  - **(b) Credenciais derivadas, consumidas pelo servidor e pelos testes** (o JWT
    `service_role`/`anon` já emitido, e eventualmente `sb_secret_*`): **continuam** no `.env.local`
    da aplicação (raiz do repo), como já é o caso hoje (`.env.example:18`,
    `SUPABASE_SERVICE_ROLE_KEY`) — é de lá que `next.config.ts:7`, os scripts com
    `--env-file=.env.local` (`package.json`) e `tests/spike/support/fixture.ts` as leem. **Não
    modificar esse arranjo já existente.**
  - A barreira contra exposição ao navegador não depende de qual arquivo a credencial vem: qualquer
    variável que não comece com `NEXT_PUBLIC_` já fica fora do bundle, e o guard barra
    explicitamente qualquer `NEXT_PUBLIC_*` cujo nome contenha um padrão de credencial privilegiada
    (`PRIVILEGED_NAME_PATTERN`, `isolation-guard.ts:16,61-63` — cobre `SERVICE_ROLE`, `SECRET`,
    `PRIVATE_KEY`, `ADMIN_KEY`, `DB_PASSWORD`). O guard **não** dispara hoje para
    `SUPABASE_AUTH_JWT_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` sem prefixo `NEXT_PUBLIC_` na raiz — só
    para `SUPABASE_DB_PASSWORD` (`REMOTE_PROJECT_MARKERS`, linhas 20/66-70) e para variáveis
    `NEXT_PUBLIC_*` privilegiadas. A separação (a)/(b) acima é sobre **onde a configuração de
    assinatura vive**, não sobre impedir toda credencial de estar na raiz — a categoria (b) já vive
    lá hoje, de forma segura (nunca com prefixo `NEXT_PUBLIC_`), e isso não muda.
- **Correção de fato sobre o papel `postgres`**: uma consulta de catálogo `pg_roles`
  (`COMPROVADO_PELO_REPORT`, executada no SC-V para resolver uma divergência, e reconfirmada de
  forma independente pela revisão do database-engineer neste Gate) confirma
  `rolsuper = f`, `rolbypassrls = t`, `rolcreaterole = t`, `rolcreatedb = t`, `rolreplication = t`,
  `rolcanlogin = t`. **Não é `SUPERUSER`** — um relatório do SC-V havia registrado `rolsuper = t`
  por erro de leitura (a linha lida pertencia a `supabase_admin`, que é `rolsuper = t`, não a
  `postgres`); isso está corrigido aqui e é consistente com `docs/mig-r3-3-seguranca-local.md:64`
  e `docs/mig-r3-2-barreira.md:32`. O risco é grave (ignora RLS de toda tabela, pode criar/alterar
  papéis e bancos, pode iniciar replicação) mas não equivale a execução arbitrária de código via
  superusuário do banco.
- `DECISAO_PENDENTE`, não risco automaticamente aceito: manter a senha padrão do PostgreSQL local
  (`postgres`/`postgres`) é uma decisão que precisa de confirmação explícita do usuário a cada
  Gate relevante, não um risco residual já assumido por default. O `isolation-guard.ts` **não foi
  e não deve ser modificado** para acomodar nenhuma alternativa.

## 4. Alternativas de correção

| Alternativa | Mecanismos necessários | Suporte comprovado e limitações | Dependências | Impacto nos serviços | Riscos | Critérios de validação | Condições que impedem adoção |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. Configuração suportada na CLI instalada** (`signing_keys_path` próprio, override de `publishable_key`/`secret_key`, `SUPABASE_AUTH_JWT_SECRET` customizado, senha do Postgres em `supabase/.env.local` — **este último item, não confirmado**) | Confirmar quais dessas chaves a CLI 2.118.0 realmente aceita como override (não só como default) | `PROPOSTO_NAO_IMPLEMENTADO`: só o `SUPABASE_AUTH_JWT_SECRET` tem suporte confirmado por `--help`/binário (`COMPROVADO_PELO_REPORT`, REPORT do MIG-R3.3-SC-P entregue na conversa — texto original não preservado, sobrescrito por este documento); os demais (override de ES256/`sb_*`, isolamento da senha do Postgres) são `HIPOTESE_NAO_TESTADA` | `stop`/`start` do stack para aplicar; verificação de propagação (§3.3) | Requer recriar os quatro containers que compartilham segredo | Se o override não existir de fato para ES256/`sb_*`, a mitigação fica incompleta silenciosamente | Testes `JWKS-1`/`JWKS-2`/`KEY-1` (§7) após aplicação | Se a investigação de suporte (Fase A, §5) não confirmar override para ES256/`sb_*`, não prometer isso como resolvido — só o HS256 |
| **B. Atualização controlada da CLI** (versão mais nova que documente rotação de chaves) | Levantar cronograma/changelog da CLI Supabase para mecanismo de rotação | `NAO_DETERMINADA`: não pesquisado nesta verificação | Autorização explícita do usuário para atualizar dependência de projeto | Pode alterar comportamento de outros serviços já testados (regressão ampla) | Quebra de compatibilidade com testes/scripts existentes | Suíte completa (REGRESSION-1) antes/depois do upgrade | Sem changelog que documente explicitamente rotação de ES256/`sb_*`, não adotar só com essa expectativa |
| **C. Stack local alternativo ou isolamento adicional** (ex.: proxy de rede adicional, stack Supabase self-hosted fora da CLI, containers customizados) | Substituir parte da orquestração da CLI por configuração própria | `NAO_DETERMINADA`: não avaliado tecnicamente nesta verificação; sai do "fluxo suportado pela CLI", mesma classe de objeção já registrada para editar o template do Kong (`COMPROVADO_PELO_REPORT`, REPORT do MIG-R3.3-SC-P entregue na conversa — texto original não preservado) | Manutenção própria da infraestrutura local, fora do que a CLI testa/atualiza | Alto — duplica responsabilidade de manter o stack local em sincronia com upgrades da CLI | Divergência entre ambiente de dev e o que a CLI oficial produz | Não definidos nesta verificação | Só considerar se A e B se mostrarem insuficientes E o risco for julgado alto o bastante para justificar o custo de manutenção |
| **D. Aceitação explícita e limitada de riscos residuais** | Nenhum — é decisão, não mecanismo técnico | Aplicável quando A/B/C não tiverem suporte comprovado | Documentação do risco, revisão periódica | Nenhum sobre os serviços (nada muda) | O risco documentado continua real enquanto o ambiente rodar | Revisão do risco a cada Gate subsequente que toque o mesmo componente | Só justificável tecnicamente quando as alternativas A/B/C tiverem sido investigadas e descartadas com evidência, não por omissão |

Preservados sem alteração: backend exclusivo Next.js (MIG-R3.3-P), RLS transacional, separação entre
dados operacionais e pessoais protegidos, K1–K15, D3, D4, D5, D9, D10 e as demais decisões
registradas nos REPORTs anteriores. Nenhuma alternativa acima as reabre.

## 5. Plano de implementação futura (condicionado, não aplicado)

- **Fase A** — Comprovar, por teste controlado e autorizado (não neste Gate), quais mecanismos de
  substituição/revogação de credencial (HS256, ES256, `sb_secret_*`/`sb_publishable_*`, senha do
  Postgres) a CLI 2.118.0 realmente suporta como override, não apenas como default. Para a senha
  do Postgres especificamente, a Fase A precisa responder duas perguntas distintas, não só uma:
  (i) a CLI aceita a variável como override, e (ii) essa mudança se aplica de fato a um volume
  Docker **já existente** (via `ALTER ROLE` executado pela própria CLI) ou só a um volume novo
  criado do zero — ver §6 item 2.1 para por que essa distinção é pré-condição da reversão segura.
- **Fase B** — Preparar, só para os mecanismos confirmados na Fase A, configuração própria em
  `supabase/.env.local` (git-ignorado): segredo HS256 novo (CSPRNG ≥32 bytes), `signing_keys_path`
  próprio se confirmado, override de `publishable_key`/`secret_key` se confirmado.
- **Fase C** — Validar a propagação das alterações a Auth, Storage, Realtime e Edge Runtime
  (comparação de hash de variáveis, não impressão) **e** à configuração persistida do Realtime
  (`_realtime.tenants`, só metadado).
- **Fase D** — Atualizar os consumidores autorizados das credenciais (app Next.js, scripts de
  teste) sem expor segredo ao navegador; regenerar `anon`/`service_role`.
- **Fase E** — Executar a matriz de testes completa (§7): positivos, negativos e de persistência
  após reinício e reconstrução local (`supabase db reset --local`, condicionado conforme
  `PERSIST-2`, §7 — ambiente descartável ou autorização específica, por ser operação destrutiva).
- **Fase F** — Revalidar isolamento (`isolation-guard.ts`, sem modificá-lo), integridade das
  migrações, autenticação, RLS e ausência de exposição administrativa indevida — as suítes já
  existentes (`test:security`, `test:spike:backend`, `test:db`) como pré-condição de não
  regressão.

Nenhuma fase acima foi executada. Se a Fase A não confirmar mecanismo de override para ES256 e
`sb_*`, o Gate de implementação deve apresentar essa lacuna como **decisão a tomar** (alternativa D
para esses dois itens especificamente), não considerar a vulnerabilidade original corrigida.

## 6. Reversão segura

O plano de reversão do SC-P original (remover `supabase/.env.local`, restaurar `.env.local` do app
a partir de backup) é substituído pelo procedimento abaixo, que não restaura automaticamente as
credenciais de demonstração conhecidas.

1. **Pré-condições para iniciar qualquer alteração**: `git status` limpo (exceto os próprios
   artefatos do Gate), backup dos arquivos `supabase/.env*`/`.env.local` do app antes de qualquer
   edição, e confirmação de que a Fase A (§5) identificou quais credenciais o Gate de
   implementação pretende trocar.
2. **Inventário sanitizado das configurações necessárias à recuperação**, nas duas classes de
   credencial distinguidas em §3.4: **(a)** material de assinatura/configuração da CLI —
   `SUPABASE_AUTH_JWT_SECRET`, `signing_keys_path` (se aplicável), `publishable_key`/`secret_key`
   (se aplicável), e `SUPABASE_DB_PASSWORD` **se e somente se** a Fase A vier a testá-la — vive
   **exclusivamente** em `supabase/.env.local`, nunca na raiz; **(b)** credenciais derivadas
   regeneradas (`anon`/`service_role`) — vivem, como já hoje, no `.env.local` **da aplicação**
   (raiz do repo), nunca com prefixo `NEXT_PUBLIC_`.
2.1. **Caso específico da senha do Postgres, gap identificado nesta revisão**: a §3.4 já registra
   que "não se verificou se a senha, já fixada no `initdb` do volume Docker existente, mudaria de
   fato só por variável de ambiente nova, ou se quebraria a conexão da CLI com o volume já criado".
   Isso tem uma consequência direta para a reversão: se, na prática, aplicar essa variável exigir
   um `ALTER ROLE postgres PASSWORD ...` executado contra o banco (`INFERENCIA_TECNICA`: é o jeito
   usual de mudar a senha de um papel num volume Postgres já inicializado — simplesmente definir a
   variável de ambiente pode não ter nenhum efeito sobre um volume que já existe, mas isso não foi
   verificado especificamente para o volume desta CLI), então **remover o
   arquivo `supabase/.env.local` não desfaz essa alteração no banco**; o papel continuaria com a
   senha nova até uma reversão simétrica (`ALTER ROLE` de volta, exigindo saber a senha anterior).
   **Pré-condição obrigatória, antes de qualquer teste da Fase A tocar a senha do Postgres**:
   determinar se o mecanismo de override é por variável de ambiente lida pela CLI (reversível só
   por arquivo) ou por comando SQL direto contra o volume existente (exige plano de reversão
   simétrico, não coberto pelos itens 1-2 acima). Sem essa determinação, não iniciar nenhuma
   tentativa de trocar a senha do Postgres **no volume existente deste projeto**. A determinação
   em si pode ser feita por leitura de binário/documentação ou por teste controlado num volume
   **descartável** (project-id ou volume Docker isolado, destruído ao final) — é a forma segura de
   responder à pergunta, não uma exceção à proibição acima.
3. **Estado anterior comprovadamente seguro**: hoje **não existe** um estado local anterior em que
   a chave `service_role` de demonstração estivesse invalidada — o vetor foi identificado na
   retomada do MIG-R3.3-S (§1) e permanece documentado como risco residual, não corrigido por
   nenhum Gate até aqui. **Documentar um risco não é o mesmo que autorizar restaurá-lo**: o fato de
   esse risco já estar conhecido e descrito não torna a configuração que o contém uma opção segura
   de reversão. Como não há estado local anterior que satisfaça o critério do item 4 abaixo, a
   regra é a do item 6 — **interromper o stack**, não restaurar a configuração vulnerável — sempre
   que uma tentativa de correção não puder ser revertida para algo que atenda a esse critério.
4. **Critérios para restaurar o estado anterior**: só reverter para uma configuração cujo risco já
   esteja integralmente documentado em Gate commitado **e** que não seja, ela mesma, o vetor que a
   correção pretendia fechar — nunca para uma configuração intermediária não documentada criada
   durante a tentativa de correção, e nunca para a configuração de demonstração vulnerável só
   porque ela já está descrita em outro documento.
5. **Verificações após a recuperação**: `npm run test:security` (6/6 esperado), `/auth/v1/health`
   200, `select 1` via `psql`, `supabase migration list --local` sem divergência. Essas verificações
   só se aplicam quando o item 4 identificar, de fato, um estado seguro para restaurar.
6. **Condições que obrigam interromper o stack em vez de restaurar configuração vulnerável — regra
   padrão, não exceção**: sempre que uma tentativa de correção não puder ser revertida para um
   estado que atenda ao critério do item 4 (ex.: HS256 trocado mas Storage/Realtime não
   confirmadamente atualizados, ver §3.3; ou a única alternativa de reversão seria reintroduzir a
   chave `service_role` de demonstração), o procedimento seguro é **parar o stack**
   (`supabase stop`) e aguardar Gate de correção autorizado — nunca restaurar uma configuração só
   porque o risco dela já está documentado.

Não se promete reversibilidade total sem verificar, em cada caso, se os mecanismos acima têm
suporte confirmado (Fase A).

## 7. Matriz de testes proposta (não implementada neste Gate)

| Teste | Garante | Observação de desenho |
| --- | --- | --- |
| `JWT-1` | Credenciais HS256 de demonstração recusadas em operações administrativas após correção futura | Depende da Fase A confirmar mecanismo de troca |
| `JWT-2` | Credenciais administrativas novas aceitas exclusivamente nas operações autorizadas | Mantém o contrato de uso legítimo (login normal) |
| `JWT-3` | Tokens inválidos, expirados, adulterados ou com privilégio inadequado recusados | Já parcialmente coberto por AUTH-5/AUTH-6/AUTH-7 (MIG-R3.3-P) |
| `JWT-4` | Validação separada da via ES256 administrativa | **Não declarar aceitação ou rejeição antes da prova correspondente** (§3.1) — depende de Fase A confirmar mecanismo de desautorização do `kid` fixo |
| `JWKS-1` | Lista **positiva**: todo `kid` publicado em `/auth/v1/.well-known/jwks.json` pertence ao conjunto de chaves gerado para este projeto | Reformulado a partir da proposta original (lista negativa contra um `kid` específico foi descartada — frágil a upgrades de CLI que tragam outro `kid` padrão) |
| `JWKS-2` | Verificação complementar de que a chave antiga é efetivamente **recusada** em uso, não só ausente do JWKS público | A ausência de um `kid` no JWKS não comprova, isoladamente, invalidação — precisa de teste de aceitação/rejeição real, autorizado em Gate futuro |
| `KEY-1` | Distinção e validação separada de `sb_secret_*`, `sb_publishable_*`, `anon` e `service_role` legados, respeitando os contratos e privilégios de cada tipo | Não tratar os quatro como intercambiáveis |
| `SERVICE-1` | Invalidação das credenciais antigas verificada em Auth, Storage e Realtime, sem confundir operação pública legítima com falha de autorização | Reaproveita a técnica de comparação de hash de variáveis de ambiente já usada no SC-V |
| `EDGE-1` | Teste do Edge Runtime | **Só executar após esclarecer a causa da parada do serviço** (§3.3) — não classificar `503` de serviço indisponível como rejeição válida de credencial |
| `TENANT-1` | Após rotação, `_realtime.tenants` reflete o segredo novo, não só a variável de ambiente do container | Só metadado/hash comparado, nunca segredo impresso |
| `PERSIST-1` | Persistência das configurações seguras após reinício completo, em shell limpo (sem variáveis exportadas acidentalmente) | Cobre o risco operacional de PowerShell (`$env:` de sessão) citado no SC-V |
| `PERSIST-2` | Reconstrução local segura (`supabase db reset --local`) sem retorno silencioso às credenciais de demonstração | **`supabase db reset --local` é uma operação destrutiva** (recria o banco do zero). Só executar em ambiente descartável (volume/projeto isolado, nunca o volume de desenvolvimento em uso) ou mediante autorização específica do usuário para essa operação — a autorização geral do Gate de implementação futuro não cobre operações potencialmente destrutivas por si só |
| `ADMIN-1` | Repetição da prova HTTP e em navegador real de outra origem local, incluindo a chave de demonstração antiga, a chave `anon`, uma chave fictícia e a credencial administrativa substituta | Amplia o ADM-1 existente (§8, correção M1) |
| `NET-1` | Preservação da publicação exclusivamente em loopback; recusa em interfaces não autorizadas | Já existente, mantido sem alteração |
| `CORS-1` | Se a decisão pendente 3 (§10) vier a ser "corrigir" em vez de "aceitar": Kong deixa de responder `Access-Control-Allow-Origin: *` nas rotas administrativas | Hoje fora de escopo por design — nenhuma correção suportada pela CLI foi identificada (§9); registrado aqui para não parecer omissão silenciosa caso a decisão mude |
| `REBIND-1` | Confirmar (ou refutar) que DNS rebinding assume a origem do Kong e contorna a restrição de CORS | Não implementável neste Gate nem no próximo sem infraestrutura de teste externa (domínio controlável fazendo rebinding para `127.0.0.1`); requer autorização e desenho próprios |
| `REGRESSION-1` | Preservação das suítes já existentes aplicáveis à arquitetura atual (`test:security` 6/6, `test:spike:backend` 18/18, `test:db` 179/179) | Resultados citados são referência histórica de Gates anteriores, **não** execução deste Gate |

Testes futuros usam só contas e dados fictícios; nenhum imprime tokens ou credenciais completas.

## 8. Fragilidades dos testes anteriores incorporadas

Pendências explícitas para a matriz do Gate de implementação futuro:

- **M1** — a futura `ADM-1` deve incluir explicitamente a credencial de demonstração conhecida
  (hoje só testada em vetores administrativos específicos), a chave `anon`, e os controles
  apropriados de origem — não só "sem chave"/"chave fictícia".
- **M2** — distinguir execução efetiva de SQL da simples reprodução de um marcador no corpo da
  resposta HTTP. Um teste que só verifica ausência do marcador `select '<marcador>'` na resposta
  não prova, por si, que o comando não teve efeito colateral fora do valor retornado; planejar
  controles que observem efeito verificável (ex.: contador incrementado, linha criada) em ambiente
  de teste isolado, como já feito pela "sonda de execução" do MIG-R3.3-P (`tests/spike/mig-r3-3-
  data-api.test.ts`).
- **M3** — separar claramente os testes HTTP legados dependentes da Data API (PostgREST) dos
  testes da arquitetura atual (conexão direta do backend). Os 12 testes de `tests/integration` que
  exigem `[api] enabled = true` (MIG-R3.3-S §7.3) não devem ser apagados nem contabilizados como
  aprovação integral da suíte enquanto dependerem de um serviço hoje desligado por decisão de
  segurança.
- **B1** — qualquer teste futuro que inventarie containers via `docker ps` (como o atual `ADM-2`)
  deve conferir explicitamente o código de saída do comando, não só interpretar a ausência de
  nomes esperados na saída como prova de que os containers não existem.
- **B2** — tratar falha de comando, saída vazia inesperada ou estado indeterminado de forma
  conservadora: nunca interpretar ausência de resultado (erro de conexão, timeout, comando que não
  rodou) como prova de que o ambiente está seguro. Isso se aplica diretamente ao estado atual do
  Edge Runtime (§3.3): um `503` por container parado não é evidência de "credencial recusada".

Referência histórica, não execução deste Gate: `test:security` 6/6, `test:spike:backend` 18/18,
`test:db` 179/179 (MIG-R3.3-S). O controle `EXPECT_ADMIN_SURFACE=open` exige ambiente
deliberadamente reconfigurado para demonstrar exposição — não deve ser executado contra a
configuração protegida nem tratado como obrigatório fora desse propósito.

## 9. CORS, cadastro e Mailpit

- CORS permissivo (`*`) no Kong local permanece documentado como risco residual (MIG-R3.3-S/SC-P).
  Não há indício de correção suportada pela CLI sem editar um template não documentado.
- **Não afirmar** que a exposição pela internet pública foi comprovada. A prova em navegador do
  SC-P (Playwright) foi feita a partir de outra origem **na mesma máquina**, não da internet.
- DNS rebinding é tratado como vetor **potencial** (`HIPOTESE_NAO_TESTADA`), não como exploração já
  demonstrada neste projeto — nenhum Gate até aqui executou um teste real de rebinding contra o
  stack.
- Aceitação do CORS permissivo permanece `DECISAO_PENDENTE` do usuário, condicionada ao contexto e
  às demais proteções (rede loopback-only).
- `[auth] enable_signup = false` permanece candidata **não avaliada** quanto a impacto em
  autenticação e testes — não alterada neste Gate.
- Decisão sobre Mailpit (`:40204`) e sua superfície local permanece pendente, registrada
  separadamente desde o MIG-R3.3-S (§9.4).

## 10. Riscos residuais e decisões pendentes do usuário

0. **Risco ativo, não aceito e não corrigido**: a chave `service_role` de demonstração concede
   acesso total à Auth Admin API local agora — é a causa do MIG-R3.3-S estar `BLOCKED` (§1) e não
   um risco cuja aceitação já foi decidida. Nenhuma das decisões pendentes abaixo o resolve por si
   só; ele só fica endereçado quando a Fase A (item 1 abaixo) confirmar um mecanismo de rotação
   eficaz (§4/§5) e um Gate de implementação futuro for autorizado e executado.
1. `DECISAO_PENDENTE`: autorizar (ou não) a Fase A (§5) — investigação, em Gate futuro, de quais
   mecanismos de override de credencial (ES256, `sb_*`, senha do Postgres) a CLI realmente
   suporta, condição prévia a qualquer rotação.
2. `DECISAO_PENDENTE`: confirmar a manutenção da senha padrão do PostgreSQL local — não é mais
   apresentada como risco automaticamente aceito, mas como decisão explícita a renovar a cada Gate
   relevante (§3.4).
3. `DECISAO_PENDENTE`: aceitar (ou não) o CORS permissivo do Kong como risco residual (§9).
4. `DECISAO_PENDENTE`: avaliar `[auth] enable_signup = false` em Gate futuro (§9).
5. `DECISAO_PENDENTE`: decisão sobre Mailpit (§9), herdada do MIG-R3.3-S.
6. `NAO_DETERMINADA`: causa da parada do container do Edge Runtime — precisa de investigação antes
   de qualquer teste (`EDGE-1`) depender desse serviço.
7. `HIPOTESE_NAO_TESTADA`: persistência de configuração do Realtime em `_realtime.tenants` após
   rotação futura (§3.3) — verificação pendente para Fase C (§5).
8. `NAO_DETERMINADA`: contradição não resolvida sobre a origem da chave `oct` do
   `SUPABASE_JWKS` (deriva do HS256 ou é independente) — §3.3.

## 11. Revisão dos agentes, objeções e limitações

Esta retificação foi produzida a partir do REPORT do MIG-R3.3-SC-V, que já havia sido revisado
nesta mesma sessão por security-specialist, database-engineer, devops-engineer, qa-engineer e
independent-reviewer. Este Gate específico de retificação documental não executou nova
investigação técnica sobre o ambiente — a única exceção é uma reconsulta de catálogo (`pg_roles`,
só leitura) feita pelo database-engineer nesta sessão para confirmar um valor já citado (§3.4),
sem gerar fato novo além do já registrado no SC-V. O trabalho deste Gate foi reclassificar e
corrigir as conclusões existentes, em duas rodadas:

**Rodada 1 — objeções herdadas do revisor independente do MIG-R3.3-SC-V:**
- A divergência sobre `rolsuper` do papel `postgres` (SC-V §6/§11, objeção bloqueante O1) está
  resolvida e incorporada em §3.4 acima, com o valor correto (`rolsuper = f`).
- As objeções O2 (senha do Postgres via `supabase/.env.local`), O3 (ES256, alcance da chave
  conhecida), O4 (propagação por restart, persistência do Realtime, contradição sobre a chave
  `oct`) e O7 (rebinding, contradição de working tree) do revisor independente do SC-V foram
  incorporadas como `HIPOTESE_NAO_TESTADA`/`NAO_DETERMINADA` em §3, não como fatos.
- As propostas de teste `JWKS-1` e `ISO-GUARD-1` do qa-engineer do SC-V foram revisadas pelo
  revisor independente: `JWKS-1` foi reformulada aqui como lista positiva (§7); `ISO-GUARD-1` foi
  descartada por ser tautológica (o guard já lança exceção nesse cenário) e substituída pela
  recomendação de um caso unitário específico para `SUPABASE_DB_PASSWORD`, condicionado à decisão
  pendente 2 (§10).

**Rodada 2 — revisão deste próprio Gate de retificação, sobre o texto que a Rodada 1 produziu:**
- **security-specialist**: apontou uma afirmação falsa (corrigida, §12) de que
  `docs/mig-r3-3-seguranca-local.md` reproduzia o segredo HS256 em sua §2.1 — o segredo estava, na
  verdade, no texto original do SC-P que este documento substituiu, não em nenhum REPORT commitado.
  Apontou falta de reconciliação sobre a transição de estado do Edge Runtime (corrigida, §3.3).
  Apontou uso do rótulo `INSPECAO_READ_ONLY` para evidência de Gate anterior (corrigido para
  `COMPROVADO_PELO_REPORT`, §3.1/§3.4).
- **database-engineer**: reconfirmou os valores de `pg_roles` (§3.4) por consulta direta. Apontou
  um gap real na reversão segura (§6) sobre a senha do Postgres/volume Docker/`initdb`, incorporado
  como item 2.1 de §6 e ajuste na Fase A (§5).
- **qa-engineer**: aprovou a matriz de testes reformulada; apontou ausência de linhas para CORS e
  DNS rebinding na matriz, incorporadas como `CORS-1`/`REBIND-1` (§7).
- **independent-reviewer (revisão final deste Gate)**: encontrou que a correção da Rodada 1 havia
  introduzido atribuições incorretas ao MIG-R3.3-S commitado (o vetor `service_role`/Auth Admin API
  e o status BLOCKED vêm do REPORT do SC-P, entregue só na conversa, não do S — corrigido em §1,
  §3.1 e §6 item 3; **esta atribuição foi por sua vez refinada pela Rodada 3, item 1**: a origem
  correta é a retomada do MIG-R3.3-S, não o SC-P, que só acrescentou a prova por navegador), uma contradição sobre se este Gate executou ou não investigação técnica
  (corrigido acima, primeiro parágrafo desta seção), um bloqueio inadvertido da Fase A pelo item 2.1
  de §6 (corrigido para permitir teste em volume descartável, não no volume existente do projeto),
  e inconsistências pontuais de rótulo/texto em §3.2, §3.3, §6 e §12 (corrigidas). Registrou como
  pendência não bloqueante (não incorporada nesta rodada): investigar se outros papéis internos do
  Supabase (`supabase_auth_admin`, `supabase_storage_admin`, `authenticator`, `supabase_admin`)
  compartilham a mesma senha inicial do `postgres`, o que afetaria o escopo da Fase A e da
  reversão — fica como item adicional para a Fase A de um Gate de implementação futuro.

**Rodada 3 — cinco correções pontuais adicionais, fornecidas diretamente pelo usuário após a
Rodada 2:**
1. **Cronologia refinada** (§1, §3.1, §6 item 3): a atribuição da Rodada 2 ("o vetor `service_role`/
   Auth Admin API vem do REPORT do SC-P, não do S") estava incompleta. A informação correta,
   fornecida nesta rodada: foi a **retomada** do MIG-R3.3-S que identificou a exposição da Auth
   Admin API e encerrou aquele Gate como BLOCKED; o MIG-R3.3-SC-P **acrescentou** a essa exposição
   já conhecida a prova por navegador real. Corrigido em todos os três pontos citados.
2. **Reversão segura reforçada** (§6 itens 3, 4 e 6): documentar um risco não autoriza restaurá-lo.
   A redação anterior podia ser lida como permitindo reverter para a configuração de demonstração
   vulnerável só porque ela "já é conhecida e documentada". Corrigido para deixar explícito que,
   sem estado anterior comprovadamente seguro, a regra padrão é interromper o stack, não restaurar.
3. **Distinção `supabase/.env.local` × `.env.local` da aplicação** (§3.4): adicionada como ponto
   próprio, com referência à barreira já existente contra vazamento de credencial ao navegador
   (`isolation-guard.ts:16,61-63`, `PRIVILEGED_NAME_PATTERN`).
4. **Histórico do Edge Runtime retificado** (§3.3): a Rodada 2 havia corrigido a atribuição de causa,
   mas manteve uma inferência (baseada no `404` do MIG-R3.3-S commitado) de que o container
   "provavelmente estava de pé" naquele Gate. Informação fornecida nesta rodada: o container **já
   estava parado na retomada do MIG-R3.3-S** — anterior ao MIG-R3.3-SC-V. A inferência anterior foi
   retirada; a causa da parada permanece `NAO_DETERMINADA`.
5. **`PERSIST-2` condicionado** (§7): `supabase db reset --local` é uma operação destrutiva;
   adicionada exigência explícita de ambiente descartável ou autorização específica para executá-la.

- Nenhuma revisão realizada em nenhuma das três rodadas constitui auditoria externa independente —
  todos os agentes e instruções envolvidos são deste mesmo ecossistema ou do usuário diretamente.
- Objeções não resolvidas permanecem registradas como `DECISAO_PENDENTE`/`HIPOTESE_NAO_TESTADA`/
  `NAO_DETERMINADA` ao longo deste documento, não removidas ou minimizadas.

## 12. Verificação de saneamento de credenciais no documento

- O segredo HS256 de demonstração (público e universal em qualquer instalação padrão da CLI
  Supabase, citado em documentação oficial e em templates `.env.example`) **não é reproduzido**
  neste documento — descrito só por characterização (algoritmo, universalidade).
- As chaves `sb_secret_*`/`sb_publishable_*` são referenciadas só pelo prefixo do tipo, nunca pelo
  valor completo.
- O `kid` e os componentes públicos (`x`/`y`) da chave ES256 citados em §3.1 não são segredo (são
  publicados pelo próprio JWKS público do serviço) — o componente privado (`d`) nunca é
  reproduzido em nenhum documento deste projeto.
- Nenhum token, chave de assinatura ou segredo de rotação completo aparece neste documento. A
  senha padrão do PostgreSQL local (`postgres`/`postgres`, citada por extenso em §3.4) é o único
  literal completo de **credencial** neste documento (o `kid` ES256 citado em §3.1 também aparece
  por extenso, mas não é credencial — é um identificador público do JWKS) — mantida
  deliberadamente porque é o default público e documentado de qualquer instalação da CLI Supabase
  local, não um segredo específico deste projeto; sua manutenção é `DECISAO_PENDENTE` (§10), não um
  fato escondido.
- **Verificado, correção de um erro deste documento**: uma versão anterior desta seção afirmava
  que `docs/mig-r3-3-seguranca-local.md` reproduzia o segredo HS256 de demonstração em sua §2.1.
  Isso é **falso** — conferido por leitura: essa seção do arquivo commitado trata do gateway Kong
  e não contém nenhum segredo; a própria linha 7 do arquivo declara "Nenhuma senha, JWT ou chave
  está registrada aqui", e isso se confirma. O segredo HS256 estava citado por extenso no texto
  **original** do MIG-R3.3-SC-P (o mesmo arquivo que este documento substituiu, entregue só na
  conversa antes desta retificação) — não em nenhum REPORT commitado. Não há, portanto, saneamento
  pendente em `docs/mig-r3-3-seguranca-local.md` quanto a esse segredo.

## 13. Estado final do Git e declaração de ausência de publicação

Idêntico ao §0: branch `security/mig-r3-3-local-admin`, HEAD `9f2f150`, sem commit criado por este
Gate. Nenhum push, nenhum PR, nenhum deploy, nenhuma alteração de produção, nenhum acesso a projeto
Supabase hospedado ou ao Firebase.

```
VALIDACAO_TECNICA=REVISAO_DOCUMENTAL
VALIDACAO_AUTOMATIZADA=NAO_EXECUTADA_NESTE_GATE
AI_VISUAL_REVIEW=NAO_APLICAVEL
HUMAN_VISUAL_REVIEW=NAO_APLICAVEL
ESTADO_DE_PUBLICACAO=NENHUMA_PUBLICACAO
```

## 14. Veredito

Retificação documental concluída. Este Gate não avalia nem aprova a correção do risco em si —
apenas a consistência técnica do planejamento. Critérios de aceitação do §15 do Gate original
atendidos: as quatro correções obrigatórias do SC-V estão incorporadas (§3), credenciais e
mecanismos de assinatura diferenciados (§3.2), aceitação administrativa de ES256 identificada como
não comprovada (§3.1), causa da parada do Edge Runtime mantida como não determinada (§3.3), senha
padrão registrada como decisão pendente (§3.4/§10), reversão não restaura credenciais conhecidas
automaticamente (§6), matriz de testes contempla revogação, JWKS, serviços, persistência e
controles negativos (§7), fragilidades M1–M3/B1–B2 incorporadas (§8), documento sem credenciais
completas (§12), revisão crítica registrada com suas limitações (§11), e apenas este arquivo foi
alterado.

**Aguardando revisão e veredito do ChatGPT antes de qualquer progressão. Não iniciar
implementação, UX-0 ou MIG-R4. Nenhum commit foi criado.**
