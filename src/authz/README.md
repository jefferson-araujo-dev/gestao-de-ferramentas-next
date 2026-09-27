# authz

Autorização da aplicação no servidor (perfis, permissões por operação). Ainda sem código
TypeScript: nenhuma API de negócio existe antes do MIG-R4.

A autorização em vigor hoje está no banco (MIG-R3/R3.1): esquema `authz` do PostgreSQL
(`authz.current_access_level()`), GRANTs, RLS e views operacionais — ver
`docs/mig-r3-modelo.md`. Quando o servidor usar a service role (que ignora RLS), a verificação
de autorização por operação deverá ficar aqui, explicitamente.
