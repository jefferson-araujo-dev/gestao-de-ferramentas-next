// Contratos iniciais das respostas operacionais (MIG-R3.1). Cada contrato é uma allowlist
// explícita de campos; nada fora dela chega a uma resposta. `project` copia somente os campos
// permitidos (nunca propaga o objeto de origem) e `assertShape` recusa campo extra ou ausente em
// qualquer profundidade. Os nomes seguem as colunas das views operacionais do banco.
//
// Nenhuma API de negócio usa estes contratos ainda; a consulta nominal (D3) terá contrato próprio
// no Gate da API de backend.

/** Campo escalar (string, número, booleano ou null) — objetos e arrays são recusados. */
type Scalar = 'scalar';
export type Shape = { readonly [field: string]: Scalar | Shape | readonly [Shape] };

export interface ToolOperational {
  id: string;
  code: string;
  name: string;
  category: string | null;
  condition: string | null;
  next_maintenance: string | null;
  is_complete: boolean;
  status: 'available' | 'borrowed' | 'maintenance';
}

export interface ToolMovementLog {
  id: string;
  tool_id: string;
  kind: 'out' | 'in' | 'maintenance';
  occurred_at: string;
}

export interface ToolImage {
  tool_id: string;
  storage_path: string;
}

export interface ToolOperationalDetail {
  tool: ToolOperational;
  image: ToolImage | null;
  movements: ToolMovementLog[];
}

// `satisfies` faz o compilador recusar campo a mais ou a menos em relação à interface.
export const toolOperationalShape = {
  id: 'scalar',
  code: 'scalar',
  name: 'scalar',
  category: 'scalar',
  condition: 'scalar',
  next_maintenance: 'scalar',
  is_complete: 'scalar',
  status: 'scalar',
} as const satisfies Record<keyof ToolOperational, Scalar>;

export const toolMovementLogShape = {
  id: 'scalar',
  tool_id: 'scalar',
  kind: 'scalar',
  occurred_at: 'scalar',
} as const satisfies Record<keyof ToolMovementLog, Scalar>;

export const toolImageShape = {
  tool_id: 'scalar',
  storage_path: 'scalar',
} as const satisfies Record<keyof ToolImage, Scalar>;

export const toolOperationalDetailShape = {
  tool: toolOperationalShape,
  image: toolImageShape,
  movements: [toolMovementLogShape],
} as const satisfies Record<keyof ToolOperationalDetail, Shape | readonly [Shape]>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectField(spec: Shape[string], value: unknown, path: string): unknown {
  if (spec === 'scalar') {
    if (value !== null && typeof value === 'object') {
      throw new Error(`${path}: esperado valor escalar, recebido objeto/array`);
    }
    return value;
  }
  if (Array.isArray(spec)) {
    if (!Array.isArray(value)) throw new Error(`${path}: esperado array`);
    return value.map((item, i) => projectObject(spec[0], item, `${path}[${i}]`));
  }
  // Objeto aninhado opcional: null é aceito, qualquer outro valor precisa respeitar o contrato.
  return value === null ? null : projectObject(spec as Shape, value, path);
}

function projectObject(shape: Shape, source: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(source)) throw new Error(`${path}: esperado objeto`);
  const out: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(shape)) {
    if (!(field in source)) throw new Error(`${path}.${field}: campo obrigatório ausente`);
    out[field] = projectField(spec, source[field], `${path}.${field}`);
  }
  return out;
}

/** Monta a resposta copiando SOMENTE os campos da allowlist (campos extras são descartados). */
export function project<T>(shape: Shape, source: unknown): T {
  return projectObject(shape, source, '$') as T;
}

/** Valida uma resposta pronta: falha em campo extra ou ausente, em qualquer nível. */
export function assertShape(shape: Shape, value: unknown, path = '$'): void {
  if (!isPlainObject(value)) throw new Error(`${path}: esperado objeto`);
  for (const field of Object.keys(value)) {
    if (!(field in shape)) throw new Error(`${path}.${field}: campo não permitido`);
  }
  for (const [field, spec] of Object.entries(shape)) {
    const fieldPath = `${path}.${field}`;
    if (!(field in value)) throw new Error(`${fieldPath}: campo obrigatório ausente`);
    const v = value[field];
    if (spec === 'scalar') {
      if (v !== null && typeof v === 'object') throw new Error(`${fieldPath}: esperado valor escalar`);
    } else if (Array.isArray(spec)) {
      if (!Array.isArray(v)) throw new Error(`${fieldPath}: esperado array`);
      v.forEach((item, i) => assertShape(spec[0], item, `${fieldPath}[${i}]`));
    } else if (v !== null) {
      assertShape(spec as Shape, v, fieldPath);
    }
  }
}
