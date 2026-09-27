# CFG-AGENTS-0 — Equipe virtual sênior

Gate de configuração: cria os subagentes de projeto usados nos próximos Gates. Não implementa
funcionalidade nem altera comportamento de segurança/produto.

## Equipe e arquivo de definição

| Agente | Papel | Arquivo | Model | Effort | Acesso |
|---|---|---|---|---|---|
| Claude principal | Principal Software Architect / Tech Lead — coordena os demais | (sessão principal, sem arquivo) | — | — | total |
| security-specialist | Principal Security Engineer | `.claude/agents/security-specialist.md` | sonnet | high | leitura/escrita + shell |
| database-engineer | Staff Database Engineer | `.claude/agents/database-engineer.md` | sonnet | high | leitura/escrita + shell |
| backend-engineer | Senior Backend Engineer | `.claude/agents/backend-engineer.md` | sonnet | medium | leitura/escrita + shell |
| qa-engineer | Senior SDET / QA Automation Engineer | `.claude/agents/qa-engineer.md` | sonnet | medium | leitura/escrita + shell |
| frontend-designer | Staff Product Designer (frontend) | `.claude/agents/frontend-designer.md` | sonnet | medium | leitura/escrita + shell |
| devops-engineer | Senior DevOps / Platform Engineer | `.claude/agents/devops-engineer.md` | sonnet | medium | leitura/escrita + shell |
| independent-reviewer | Principal Software & Security Reviewer | `.claude/agents/independent-reviewer.md` | opus | high | **somente leitura** (`tools: Read, Grep, Glob`, sem Write/Edit/Bash) |

Opus foi reservado apenas para o auditor independente, que precisa do maior rigor de julgamento e não
executa volume de código; os demais usam Sonnet, evitando Opus como modelo universal.

## Regra de acionamento

- O Claude principal aciona apenas os especialistas necessários em cada Gate, nunca todos por padrão.
- Dois agentes não devem editar o mesmo arquivo na mesma janela de trabalho.
- Nenhum agente aprova o próprio trabalho; toda entrega passa pelo `independent-reviewer` antes de ser
  considerada concluída.
- `independent-reviewer` só pode ler e comentar; qualquer mudança que ele apontar é executada por outro
  agente.

## Limite técnico confirmado (Effort e Thinking)

O campo `effort` existe na definição do subagente e é respeitado. **Não existe campo de "Thinking" por
subagente**: extended thinking é herdado da sessão principal, não pode ser configurado individualmente
por agente. Isso contraria a expectativa original de "Escolher modelo, Effort e Thinking individualmente
para cada Gate" — Thinking só pode ser ajustado no nível da sessão, não por agente.

## Segurança

Mantidas todas as decisões K1–K15 e as barreiras dos Gates já concluídos (MIG-R3, R3.1, R3.2, R3.3-S).
Nenhum agente tem instrução ou permissão para acessar Firebase de produção, usar dados reais ou disparar
deploy/Preview — essas proibições estão escritas explicitamente no prompt de cada um.
