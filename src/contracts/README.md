# contracts

Contratos de entrada/saída compartilhados entre camadas. `operational.ts` (MIG-R3.1) define as
allowlists das respostas operacionais sanitizadas (`project`, `assertShape`). Nenhuma API de
negócio os usa ainda; a consulta nominal terá contrato próprio no Gate da API de backend.
