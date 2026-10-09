// Safe formula engine for Control Plane calculated columns. No eval: a small
// tokenizer + recursive-descent parser over a fixed grammar.
//   numbers, field names, + - * / %, unary -, ( ), comparisons (< > <= >= == !=),
//   MAX MIN ROUND ABS FLOOR CEIL IF
// web/src/lib/formula.js is GENERATED from this file: run `node scripts/sync-formula-to-web.mjs` after editing.

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

export type FormulaNode =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'neg'; a: FormulaNode }
  | { t: 'bin'; op: string; a: FormulaNode; b: FormulaNode }
  | { t: 'call'; fn: string; args: FormulaNode[] };

type Token = { k: 'num' | 'id' | 'op' | 'end'; v: string; at: number };

export const MAX_FORMULA_LENGTH = 300;
const MAX_DEPTH = 24;

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  max: { min: 2, max: 8 },
  min: { min: 2, max: 8 },
  round: { min: 1, max: 2 },
  abs: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  if: { min: 3, max: 3 },
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      const match = /^(?:\d+\.?\d*|\.\d+)/.exec(source.slice(i));
      if (!match) throw new FormulaError(`Unexpected "." at position ${i + 1}.`);
      tokens.push({ k: 'num', v: match[0], at: i });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ k: 'id', v: match[0].toLowerCase(), at: i });
      i += match[0].length;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '<>'].includes(two)) {
      tokens.push({ k: 'op', v: two === '<>' ? '!=' : two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/%(),<>='.includes(ch)) {
      tokens.push({ k: 'op', v: ch === '=' ? '==' : ch, at: i });
      i += 1;
      continue;
    }
    throw new FormulaError(`"${ch}" is not allowed in a formula (position ${i + 1}).`);
  }
  tokens.push({ k: 'end', v: '', at: source.length });
  return tokens;
}

export function parseFormula(source: string): FormulaNode {
  const text = String(source ?? '');
  if (!text.trim()) throw new FormulaError('Write a formula first.');
  if (text.length > MAX_FORMULA_LENGTH) throw new FormulaError(`A formula can be at most ${MAX_FORMULA_LENGTH} characters.`);
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const isOp = (value: string) => peek().k === 'op' && peek().v === value;

  function expect(value: string): void {
    if (!isOp(value)) throw new FormulaError(`Expected "${value}" at position ${peek().at + 1}.`);
    pos += 1;
  }

  function comparison(depth: number): FormulaNode {
    let left = additive(depth);
    while (peek().k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = take().v;
      left = { t: 'bin', op, a: left, b: additive(depth) };
    }
    return left;
  }

  function additive(depth: number): FormulaNode {
    let left = multiplicative(depth);
    while (isOp('+') || isOp('-')) {
      const op = take().v;
      left = { t: 'bin', op, a: left, b: multiplicative(depth) };
    }
    return left;
  }

  function multiplicative(depth: number): FormulaNode {
    let left = unary(depth);
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = take().v;
      left = { t: 'bin', op, a: left, b: unary(depth) };
    }
    return left;
  }

  function unary(depth: number): FormulaNode {
    if (isOp('-')) { pos += 1; return { t: 'neg', a: unary(depth) }; }
    if (isOp('+')) { pos += 1; return unary(depth); }
    return primary(depth);
  }

  function primary(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) throw new FormulaError('This formula is nested too deeply.');
    const token = take();
    if (token.k === 'num') return { t: 'num', v: Number(token.v) };
    if (token.k === 'id') {
      if (isOp('(')) {
        const spec = FUNCTIONS[token.v];
        if (!spec) throw new FormulaError(`Unknown function "${token.v.toUpperCase()}". You can use: ${Object.keys(FUNCTIONS).map((name) => name.toUpperCase()).join(', ')}.`);
        pos += 1;
        const args: FormulaNode[] = [];
        if (!isOp(')')) {
          do { args.push(comparison(depth + 1)); } while (isOp(',') && (pos += 1));
        }
        expect(')');
        if (args.length < spec.min || args.length > spec.max) {
          throw new FormulaError(`${token.v.toUpperCase()} needs ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} value(s) but got ${args.length}.`);
        }
        return { t: 'call', fn: token.v, args };
      }
      return { t: 'id', name: token.v };
    }
    if (token.k === 'op' && token.v === '(') {
      const inner = comparison(depth + 1);
      expect(')');
      return inner;
    }
    throw new FormulaError(token.k === 'end' ? 'The formula ends too early.' : `Unexpected "${token.v}" at position ${token.at + 1}.`);
  }

  const ast = comparison(0);
  if (peek().k !== 'end') throw new FormulaError(`Unexpected "${peek().v}" at position ${peek().at + 1}.`);
  return ast;
}

export function formulaFields(node: FormulaNode, into = new Set<string>()): Set<string> {
  if (node.t === 'id') into.add(node.name);
  else if (node.t === 'neg') formulaFields(node.a, into);
  else if (node.t === 'bin') { formulaFields(node.a, into); formulaFields(node.b, into); }
  else if (node.t === 'call') node.args.forEach((arg) => formulaFields(arg, into));
  return into;
}

/** Parses and checks that every field is one of `allowed`. Returns the AST. */
export function validateFormula(source: string, allowed: readonly string[]): FormulaNode {
  const ast = parseFormula(source);
  for (const name of formulaFields(ast)) {
    if (!allowed.includes(name)) throw new FormulaError(`Unknown field "${name}". You can use: ${allowed.join(', ')}.`);
  }
  return ast;
}

export function evaluateFormula(node: FormulaNode, values: Record<string, number>): number {
  const result = run(node, values);
  if (!Number.isFinite(result)) throw new FormulaError('The result is not a number.');
  return result;
}

function run(node: FormulaNode, values: Record<string, number>): number {
  switch (node.t) {
    case 'num': return node.v;
    case 'id': {
      const value = values[node.name];
      if (value === undefined) throw new FormulaError(`Unknown field "${node.name}".`);
      return Number(value) || 0;
    }
    case 'neg': return -run(node.a, values);
    case 'bin': {
      const a = run(node.a, values);
      const b = run(node.b, values);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new FormulaError('Division by zero.'); return a / b;
        case '%': if (b === 0) throw new FormulaError('Division by zero.'); return a % b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default: throw new FormulaError(`Unsupported operator ${node.op}.`);
      }
    }
    case 'call': {
      if (node.fn === 'if') return run(node.args[0], values) !== 0 ? run(node.args[1], values) : run(node.args[2], values);
      const args = node.args.map((arg) => run(arg, values));
      switch (node.fn) {
        case 'max': return Math.max(...args);
        case 'min': return Math.min(...args);
        case 'abs': return Math.abs(args[0]);
        case 'floor': return Math.floor(args[0]);
        case 'ceil': return Math.ceil(args[0]);
        case 'round': {
          const digits = Math.max(0, Math.min(6, Math.trunc(args[1] ?? 0)));
          const factor = 10 ** digits;
          return Math.round((args[0] + Number.EPSILON) * factor) / factor;
        }
        default: throw new FormulaError(`Unknown function ${node.fn}.`);
      }
    }
  }
}

/** Stock fields a calculated stock column may use. */
export const STOCK_FORMULA_FIELDS = ['physical', 'book', 'variance', 'quarantine', 'reserved', 'value'] as const;
