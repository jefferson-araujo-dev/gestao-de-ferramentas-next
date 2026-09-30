// Testes mínimos do Shell/Dashboard (Gate UX-1A-AJUSTES). O runner (node --test) não renderiza
// componentes React e não há biblioteca de teste de componente instalada (proibido instalar):
// por isso a cobertura é sobre lógica pura, código-fonte e o script de tema executado em vm.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { DASHBOARD_STATS, RECENT_ACTIVITY } from '../../src/lib/dashboard-mock-data.ts';
import {
  ACTION_PREFIX,
  TARGET_LABEL,
  nextTheme,
  saveTheme,
} from '../../src/components/shell/theme.ts';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- T1 Navegação ----------------------------------------------------------------------

// Rotas derivadas do sistema de arquivos: cada src/app/**/page.tsx é uma rota.
function existingRoutes(): Set<string> {
  const appDir = join(ROOT, 'src', 'app');
  return new Set(
    walk(appDir)
      .filter((f) => /[\\/]page\.tsx$/.test(f))
      .map((f) => {
        const dir = relative(appDir, join(f, '..')).split('\\').join('/');
        return dir === '' ? '/' : `/${dir}`;
      }),
  );
}

// nav-config.ts importa ícones .tsx (não carregáveis pelo runner): lê os itens do código-fonte.
function parseItems(source: string) {
  return [...source.matchAll(/\{[^{}]*label:\s*"([^"]+)"[^{}]*\}/g)].map((m) => ({
    label: m[1],
    href: /href:\s*"([^"]*)"/.exec(m[0])?.[1],
    disabled: /disabled:\s*true/.test(m[0]),
  }));
}

const navSource = read('src/components/shell/nav-config.ts');
const [desktopSource, mobileSource] = navSource.split('export const MOBILE_NAV_ITEMS');
const desktopItems = parseItems(desktopSource);
const mobileItems = parseItems(mobileSource);

test('T1a. rotas existentes são derivadas do sistema de arquivos (sanidade)', () => {
  const routes = existingRoutes();
  for (const r of ['/', '/retirar-devolver', '/ferramentas', '/colaboradores']) assert.ok(routes.has(r), r);
});

test('T1b. todo item habilitado (desktop e mobile) aponta para rota existente', () => {
  const routes = existingRoutes();
  const enabled = [...desktopItems, ...mobileItems].filter((i) => !i.disabled);
  assert.ok(enabled.length >= 8);
  for (const item of enabled) {
    assert.ok(item.href && routes.has(item.href), `"${item.label}" → ${item.href} não existe em src/app`);
  }
});

test('T1c. item desabilitado não tem href navegável', () => {
  const disabled = desktopItems.filter((i) => i.disabled);
  assert.deepEqual(disabled.map((i) => i.label), ['Auditoria']);
  for (const item of disabled) assert.equal(item.href, '#');
});

test('T1d. navegação mobile = Painel, Scanner, Ferramentas, Equipe', () => {
  assert.deepEqual(
    mobileItems.map((i) => [i.label, i.href]),
    [
      ['Painel', '/'],
      ['Scanner', '/retirar-devolver'],
      ['Ferramentas', '/ferramentas'],
      ['Equipe', '/colaboradores'],
    ],
  );
});

// ---- T2 Tema ---------------------------------------------------------------------------

// Executa o script de tema REAL (extraído de layout.tsx) num ambiente simulado.
function runThemeInitScript(opts: {
  stored?: string | null;
  prefersDark?: boolean;
  throws?: boolean; // getItem lança (storage bloqueado)
  matchMediaThrows?: boolean;
}) {
  const layout = read('src/app/layout.tsx');
  const script = /const THEME_INIT_SCRIPT = `([\s\S]*?)`;/.exec(layout)?.[1];
  assert.ok(script, 'THEME_INIT_SCRIPT não encontrado em layout.tsx');
  const attrs: Record<string, string> = {};
  const sandbox = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.throws) throw new Error('storage bloqueado');
        return k === 'theme' ? (opts.stored ?? null) : null;
      },
    },
    window: {
      matchMedia: () => {
        if (opts.matchMediaThrows) throw new Error('matchMedia indisponível');
        return { matches: !!opts.prefersDark };
      },
    },
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  vm.runInNewContext(script, sandbox);
  return attrs['data-theme'];
}

test('T2a. estado inicial: storage vazio segue a preferência do sistema', () => {
  assert.equal(runThemeInitScript({ stored: null, prefersDark: true }), 'dark');
  assert.equal(runThemeInitScript({ stored: null, prefersDark: false }), 'light');
});

test('T2b. estado inicial: valor salvo vence a preferência; valor inválido é ignorado', () => {
  assert.equal(runThemeInitScript({ stored: 'light', prefersDark: true }), 'light');
  assert.equal(runThemeInitScript({ stored: 'dark', prefersDark: false }), 'dark');
  assert.equal(runThemeInitScript({ stored: 'roxo', prefersDark: true }), 'dark');
});

test('T2c. storage bloqueado segue a preferência; matchMedia indisponível não define atributo', () => {
  assert.equal(runThemeInitScript({ prefersDark: true, throws: true }), 'dark');
  assert.equal(runThemeInitScript({ prefersDark: false, throws: true }), 'light');
  assert.equal(runThemeInitScript({ stored: null, matchMediaThrows: true }), undefined);
  // valor salvo válido vence mesmo sem matchMedia
  assert.equal(runThemeInitScript({ stored: 'dark', matchMediaThrows: true }), 'dark');
});

test('T2d. alternância e persistência: próximo tema salvo é relido pelo script inicial', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(runThemeInitScript({ stored: nextTheme('light'), prefersDark: false }), 'dark');
  // O componente grava via saveTheme (T2f); o setItem em si é testado lá.
  assert.match(read('src/components/shell/ThemeToggle.tsx'), /saveTheme\(storage, next\)/);
});

test('T2e. textos vêm de theme.ts; nome contém o texto visível; sem aria-label/aria-pressed', () => {
  assert.deepEqual(TARGET_LABEL, { dark: 'modo escuro', light: 'modo claro' });
  assert.equal(ACTION_PREFIX, 'Ativar ');
  // Nome acessível composto = prefixo (sr-only) + rótulo visível ativo; contém o texto visível (WCAG 2.5.3).
  assert.equal(ACTION_PREFIX + TARGET_LABEL.dark, 'Ativar modo escuro');
  assert.equal(ACTION_PREFIX + TARGET_LABEL.light, 'Ativar modo claro');
  for (const theme of ['light', 'dark'] as const) {
    const visible = TARGET_LABEL[theme].charAt(0).toUpperCase() + TARGET_LABEL[theme].slice(1);
    assert.ok((ACTION_PREFIX + TARGET_LABEL[theme]).toLowerCase().includes(visible.toLowerCase()));
  }
  const src = stripComments(read('src/components/shell/ThemeToggle.tsx'));
  assert.doesNotMatch(src, /aria-pressed|aria-label/);
  assert.match(src, /TARGET_LABEL\.dark/);
  assert.match(src, /TARGET_LABEL\.light/);
  assert.doesNotMatch(src, /useSyncExternalStore/);
});

test('T2f. saveTheme: storage que lança retorna false sem exceção; normal grava e retorna true', () => {
  const throwing = {
    setItem: () => {
      throw new Error('QuotaExceeded/SecurityError');
    },
  };
  assert.equal(saveTheme(throwing, 'dark'), false);
  assert.equal(saveTheme(null, 'dark'), false);
  const saved: Record<string, string> = {};
  assert.equal(saveTheme({ setItem: (k, v) => void (saved[k] = v) }, 'dark'), true);
  assert.deepEqual(saved, { theme: 'dark' });
});

test('T2g. alternador: classes do componente existem no CSS; regras padrão/escuro; first-letter:uppercase', () => {
  const tsx = stripComments(read('src/components/shell/ThemeToggle.tsx'));
  const css = stripComments(read('src/app/globals.css'));
  const used = [...new Set([...tsx.matchAll(/theme-toggle-to-(?:dark|light)/g)].map((m) => m[0]))].sort();
  assert.deepEqual(used, ['theme-toggle-to-dark', 'theme-toggle-to-light'], 'ThemeToggle.tsx deve usar as duas classes theme-toggle-to-*');
  for (const cls of used) {
    assert.match(css, new RegExp(`\\.${cls}\\s*\\{`), `globals.css não tem seletor .${cls} (classe usada em ThemeToggle.tsx)`);
  }
  assert.match(
    css,
    /(^|\n)\s*\.theme-toggle-to-light\s*\{\s*display:\s*none;?\s*\}/,
    'globals.css: falta a regra padrão que oculta .theme-toggle-to-light',
  );
  assert.match(
    css,
    /:root\[data-theme="dark"\]\s+\.theme-toggle-to-dark\s*\{\s*display:\s*none;?\s*\}/,
    'globals.css: falta :root[data-theme="dark"] .theme-toggle-to-dark { display: none }',
  );
  assert.match(
    css,
    /:root\[data-theme="dark"\]\s+\.theme-toggle-to-light\s*\{\s*display:\s*inline-block;?\s*\}/,
    'globals.css: falta :root[data-theme="dark"] .theme-toggle-to-light { display: inline-block }',
  );
  for (const cls of used) {
    const span = new RegExp(`<span[^>]*className="[^"]*${cls}[^"]*"`).exec(tsx)?.[0] ?? '';
    assert.match(span, /first-letter:uppercase/, `ThemeToggle.tsx: .${cls} sem first-letter:uppercase`);
  }
});

// ---- T3 Sem chamadas externas (GUARDA ESTÁTICA — não é prova de runtime) ---------------

const GUARDED = [
  ...walk(join(ROOT, 'src', 'components', 'shell')),
  ...walk(join(ROOT, 'src', 'components', 'dashboard')),
  join(ROOT, 'src', 'lib', 'dashboard-mock-data.ts'),
  join(ROOT, 'src', 'app', 'layout.tsx'),
  join(ROOT, 'src', 'app', 'page.tsx'),
];
const FORBIDDEN: [string, RegExp][] = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /WebSocket/],
  ['sendBeacon', /sendBeacon/],
  ['Supabase/Firebase', /supabase|firebase/i],
  ['URL http(s) externa', /https?:\/\//i],
];

test('T3. shell, dashboard e mock-data não contêm chamadas/URLs externas (guarda estática)', () => {
  assert.ok(GUARDED.length >= 10);
  for (const file of GUARDED) {
    const text = stripComments(readFileSync(file, 'utf8')); // comentários podem citar os termos
    for (const [name, re] of FORBIDDEN) {
      assert.doesNotMatch(text, re, `${relative(ROOT, file)} contém ${name}`);
    }
  }
});

// ---- T4 Dados mock ---------------------------------------------------------------------

test('T4a. quatro indicadores esperados', () => {
  assert.deepEqual(DASHBOARD_STATS.map((s) => s.value), [128, 94, 27, 7]);
});

test('T4b. três atividades, sem nome de pessoa (só ferramentas)', () => {
  assert.equal(RECENT_ACTIVITY.length, 3);
  assert.deepEqual(
    RECENT_ACTIVITY.map((a) => a.description),
    [
      'Furadeira de impacto 750W — retirada',
      'Chave de impacto pneumática — devolvida',
      'Multímetro digital — em manutenção',
    ],
  );
});

test('T4c. PENDENTE_DE_CONFIRMACAO ausente do conteúdo renderizável (só em comentário)', () => {
  const rendered = [...GUARDED, join(ROOT, 'src', 'app', 'page.tsx')]
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => stripComments(readFileSync(f, 'utf8')))
    .join('\n');
  assert.doesNotMatch(rendered, /PENDENTE_DE_CONFIRMACAO/);
  assert.match(rendered, /Dados fictícios de demonstração\./);
});
