// 渲染期崩溃的第一大类是「同一个执行路径里先用后声明」：
// const/let 存在暂时性死区，读到的瞬间直接抛 ReferenceError，
// 而组件里没有任何东西接得住它，整棵树被卸载成白屏。
// 这个检查只统计「同一条执行路径」——即不在任何内层函数里的引用，
// 因为内层函数可能要等到声明之后才被调用（那是合法写法）。
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';

const ROOT = new URL('../src/', import.meta.url);

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

function collect(node) {
  const declared = new Map();
  const add = (name, start) => {
    const seen = declared.get(name);
    if (seen === undefined || start < seen) declared.set(name, start);
  };
  const visit = (statement) => {
    if (!statement) return;
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      for (const declarator of statement.declarations) {
        if (declarator.id.type === 'Identifier') add(declarator.id.name, declarator.id.start);
      }
      return;
    }
    if (statement.type === 'ClassDeclaration' && statement.id) add(statement.id.name, statement.id.start);
    if (statement.type === 'BlockStatement') return statement.body.forEach(visit);
    if (statement.type === 'IfStatement') { visit(statement.consequent); visit(statement.alternate); return; }
    if (statement.type === 'ForStatement' || statement.type === 'ForOfStatement' || statement.type === 'ForInStatement') {
      const init = statement.init ?? statement.left;
      if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') {
        for (const declarator of init.declarations) if (declarator.id.type === 'Identifier') add(declarator.id.name, declarator.id.start);
      }
    }
  };
  for (const statement of node) visit(statement);
  return declared;
}

const NON_REFERENCE_KEY = new Set(['key', 'property', 'id', 'params', 'label', 'names']);

function scan(source, file) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
  const found = [];
  const walk = (node, scopes, deferred, parent, parentKey) => {
  if (!node || typeof node.type !== 'string') return;
  let nextScopes = scopes;
  if (FUNCTION_TYPES.has(node.type)) deferred += 1;
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    nextScopes = scopes.concat([{ declared: collect(node.body), depth: deferred }]);
  }
  if (node.type === 'Identifier') {
    if (parent && !NON_REFERENCE_KEY.has(parentKey) && !(parent.type === 'MemberExpression' && parentKey === 'property' && !parent.computed) && !(parent.type === 'JSXAttribute' && parentKey === 'name') && !(parent.type === 'ObjectProperty' && parentKey === 'key' && !parent.computed) && !(parent.type === 'ObjectMethod' && parentKey === 'key') && !(parent.type === 'ClassMethod' && parentKey === 'key') && !(parent.type === 'JSXMemberExpression')) {
      for (let index = nextScopes.length - 1; index >= 0; index -= 1) {
        const scope = nextScopes[index];
        const declared = scope.declared.get(node.name);
        if (declared === undefined) continue;
        // 只有声明所在的那一层函数与引用处于同一次求值时，才是真正的死区。
        if (declared > node.start && scope.depth === deferred) found.push({ file, name: node.name, at: node.start, declared });
        break;
      }
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') walk(item, nextScopes, deferred, node, key); }
    else if (value && typeof value.type === 'string') walk(value, nextScopes, deferred, node, key);
  }
  };
  walk(ast.program, [], 0, null, null);
  return found.map((hit) => {
    const line = source.slice(0, hit.declared).split('\n').length;
    const useLine = source.slice(0, hit.at).split('\n').length;
    return `${relative(process.cwd(), file)}: 第 ${useLine} 行用到 ${hit.name}，它到第 ${line} 行才声明`;
  });
}

test('内层作用域里先用后声明会被抓出来（自查）', () => {
  const hits = scan('function Page() { const a = b && 1; const b = 2; return a }\n', 'synthetic.jsx');
  assert.equal(hits.length, 1);
});

test('延迟调用（内层函数里引用后声明的常量）不算错', () => {
  const hits = scan('function Page() { const run = () => later; const later = 1; return run }\n', 'synthetic.jsx');
  assert.deepEqual(hits, []);
});

test('src 下没有先用后声明的渲染期引用', () => {
  const files = [];
  const walkDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walkDir(ROOT.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const problems = [];
  for (const file of files) problems.push(...scan(readFileSync(file, 'utf8'), file));
  assert.ok(files.length > 50, '组件文件没有被读到');
  assert.deepEqual(problems, [], '这些引用会在渲染期抛 ReferenceError，导致白屏：\n' + problems.join('\n'));
});