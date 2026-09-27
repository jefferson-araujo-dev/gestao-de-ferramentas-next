// Allowlists dos contratos operacionais (MIG-R3.1): campos extras — inclusive aninhados — nunca
// passam, e objetos de tabelas protegidas não são propagados.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertShape,
  project,
  toolImageShape,
  toolMovementLogShape,
  toolOperationalDetailShape,
  toolOperationalShape,
  type ToolOperational,
  type ToolOperationalDetail,
} from '../../src/contracts/operational.ts';

const tool: ToolOperational = {
  id: 't1',
  code: 'FIC-001',
  name: 'Furadeira Ficticia',
  category: null,
  condition: null,
  next_maintenance: null,
  is_complete: true,
  status: 'borrowed',
};
const movement = { id: 'm1', tool_id: 't1', kind: 'out', occurred_at: '2026-01-01T00:00:00Z' };
const image = { tool_id: 't1', storage_path: 'tools/fic-001/verificada.webp' };
const detail = { tool, image, movements: [movement] };

// Campos que existem nas tabelas protegidas e jamais podem aparecer numa resposta operacional.
const PROTECTED_FIELDS = ['collaborator_id', 'collaborator', 'custodian_name', 'badge_hmac', 'notes', 'ip', 'device', 'actor_user_id'];

test('allowlists correspondem exatamente às colunas das views operacionais', () => {
  assert.deepEqual(Object.keys(toolOperationalShape).sort(),
    ['category', 'code', 'condition', 'id', 'is_complete', 'name', 'next_maintenance', 'status']);
  assert.deepEqual(Object.keys(toolMovementLogShape).sort(), ['id', 'kind', 'occurred_at', 'tool_id']);
  assert.deepEqual(Object.keys(toolImageShape).sort(), ['storage_path', 'tool_id']);
  for (const shape of [toolOperationalShape, toolMovementLogShape, toolImageShape]) {
    for (const field of PROTECTED_FIELDS) assert.ok(!(field in shape), field);
  }
});

test('project descarta campos extras de uma linha completa de origem', () => {
  const rawRow = { ...tool, notes: 'nota administrativa', collaborator_id: 'c1', ip: '192.0.2.1', custodian_name: 'Fulano' };
  const out = project<ToolOperational>(toolOperationalShape, rawRow);
  assert.deepEqual(out, tool);
  assert.notEqual(out, rawRow);
});

test('project descarta campos extras aninhados (objeto e itens de array)', () => {
  const raw = {
    tool: { ...tool, collaborator: { name: 'Fulano' } },
    image: { ...image, verified_by: 'u1' },
    movements: [{ ...movement, actor_user_id: 'u1', device: 'dev', ip: '192.0.2.1' }],
    custody: { collaborator_id: 'c1' },
  };
  const out = project<ToolOperationalDetail>(toolOperationalDetailShape, raw);
  assert.deepEqual(out, detail);
  const text = JSON.stringify(out);
  for (const field of [...PROTECTED_FIELDS, 'custody', 'verified_by']) assert.ok(!text.includes(`"${field}"`), field);
});

test('project recusa objeto escondido em campo escalar', () => {
  assert.throws(
    () => project(toolOperationalShape, { ...tool, condition: { collaborator: { name: 'Fulano' } } }),
    /\$\.condition: esperado valor escalar/,
  );
});

test('project recusa campo obrigatório ausente', () => {
  const { status: _omit, ...withoutStatus } = tool;
  void _omit;
  assert.throws(() => project(toolOperationalShape, withoutStatus), /\$\.status: campo obrigatório ausente/);
});

test('assertShape aceita a resposta exata, com imagem nula e sem movimentos', () => {
  assert.doesNotThrow(() => assertShape(toolOperationalDetailShape, detail));
  assert.doesNotThrow(() => assertShape(toolOperationalDetailShape, { tool, image: null, movements: [] }));
});

test('assertShape recusa campo extra no nível superior', () => {
  assert.throws(() => assertShape(toolOperationalShape, { ...tool, notes: 'x' }), /\$\.notes: campo não permitido/);
});

test('assertShape recusa campo extra em objeto aninhado', () => {
  assert.throws(
    () => assertShape(toolOperationalDetailShape, { ...detail, tool: { ...tool, collaborator_id: 'c1' } }),
    /\$\.tool\.collaborator_id: campo não permitido/,
  );
  assert.throws(
    () => assertShape(toolOperationalDetailShape, { ...detail, image: { ...image, verified_by: 'u1' } }),
    /\$\.image\.verified_by: campo não permitido/,
  );
});

test('assertShape recusa campo extra em item de array aninhado', () => {
  assert.throws(
    () => assertShape(toolOperationalDetailShape, { ...detail, movements: [movement, { ...movement, ip: '192.0.2.1' }] }),
    /\$\.movements\[1\]\.ip: campo não permitido/,
  );
});

test('assertShape recusa objeto em campo escalar e campo ausente', () => {
  assert.throws(() => assertShape(toolImageShape, { tool_id: 't1', storage_path: { raw: 'x' } }), /esperado valor escalar/);
  assert.throws(() => assertShape(toolImageShape, { tool_id: 't1' }), /\$\.storage_path: campo obrigatório ausente/);
});
