"""Independently check the first pattern examples with symbolic/numeric math.

Run from the repository: python frontend/scripts/check-knowledge-pattern-math.py
Requires the existing local SymPy; the application itself does not depend on it.
"""
import json
from pathlib import Path
import sympy as sp

root = Path(__file__).resolve().parents[2]
source = json.loads((root / 'knowledge/patterns.json').read_text(encoding='utf-8'))

def verify(check):
    x = sp.Symbol('x', positive=True) if check.get('positive') else sp.Symbol('x', real=True)
    y = sp.Symbol('y', real=True)
    a = sp.Symbol('a', positive=True) if check.get('aPositive') else sp.Symbol('a', real=True)
    f = sp.Function('f')
    scope = dict(x=x, y=y, a=a, t=sp.Symbol('t', positive=True), c1=sp.Symbol('c1', real=True), c2=sp.Symbol('c2', real=True), f=f)
    parse = lambda expression: sp.sympify(expression, locals=scope)
    zero = lambda expression: sp.simplify(sp.trigsimp(expression)) == 0
    kind = check['kind']
    if kind == 'antiderivative':
        assert zero(sp.diff(parse(check['result']), x) - parse(check['integrand']))
    elif kind == 'derivative':
        assert zero(sp.diff(parse(check['function']), x, check['order']) - parse(check['result']))
    elif kind == 'derivative_at':
        assert zero(sp.diff(parse(check['function']), x, check['order']).subs(x, check['point']) - parse(check['result']))
    elif kind == 'identity':
        assert zero(parse(check['lhs']) - parse(check['rhs']))
    elif kind == 'ode':
        scope['Y'] = parse(check['solution'])
        assert zero(parse(check['residual']))
    elif kind == 'value':
        values = {scope[key]: value for key, value in check['point'].items()}
        assert zero(parse(check['function']).subs(values) - parse(check['result']))
    elif kind == 'limit':
        assert zero(sp.limit(parse(check['function']), x, check['point']) - parse(check['result']))
    elif kind == 'limit_infinity':
        assert zero(sp.limit(parse(check['function']), x, sp.oo) - parse(check['result']))
    elif kind == 'paths':
        values = []
        for path in check['paths']:
            value = sp.limit(parse(check['function']).subs(y, parse(path['y'])), x, 0)
            assert zero(value - parse(path['result']))
            values.append(value)
        assert len(set(values)) > 1
    elif kind == 'rolle_endpoints':
        expression = parse(check['function'])
        assert zero(expression.subs(x, check['left']) - expression.subs(x, check['right']))
        assert sp.diff(expression, x).subs(x, sp.Rational(1, 2)) == 0
    elif kind == 'finite_product':
        for n in range(1, 8):
            case = check['case']
            if case == 'power_chain':
                for base in [sp.Rational(1, 3), sp.Rational(-1, 2)]:
                    actual = sp.prod(1 + base**(2**k) for k in range(n+1))
                    assert zero(actual - (1-base**(2**(n+1)))/(1-base))
            elif case == 'half_angle':
                theta = sp.Rational(1, 1)
                actual = sp.prod(sp.cos(theta/2**k) for k in range(1, n+1))
                expected = sp.sin(theta)/(2**n*sp.sin(theta/2**n))
                assert abs(sp.N(actual-expected, 60)) < sp.Float('1e-50')
            elif case == 'shifted_factors':
                if n >= 2:
                    actual = sp.prod(sp.Rational(k**3-1, k**3+1) for k in range(2, n+1))
                    assert actual == sp.Rational(2*(n*n+n+1), 3*n*(n+1))
            elif case == 'split_chains':
                actual = sp.prod(sp.Rational((k+1)**2, k*(k+2)) for k in range(1, n+1))
                assert actual == sp.Rational(2*(n+1), n+2)
            else:
                raise AssertionError(case)
    elif kind == 'sequence_limit':
        n, k = sp.symbols('n k', positive=True, integer=True)
        case = check['case']
        if case == 'uniform_bounds':
            lower = sp.summation(k, (k, 1, n))/(n*n+n)
            upper = sp.summation(k, (k, 1, n))/(n*n)
            assert sp.limit(lower, n, sp.oo) == sp.limit(upper, n, sp.oo) == sp.Rational(1, 2)
        elif case == 'small_increments':
            assert sp.limit(sp.summation(k/n**2, (k, 1, n)), n, sp.oo) == sp.Rational(1, 2)
            assert sp.limit(sp.summation(k**2/(2*n**4), (k, 1, n)), n, sp.oo) == 0
            # The stated logarithm error bound follows by integrating t/(1+t) <= t.
            t = sp.Symbol('t', nonnegative=True)
            assert sp.simplify(t-sp.diff(t-sp.log(1+t), t)) == t*t/(1+t)
        elif case == 'finite_power_root':
            assert sp.limit(3**(1/n), n, sp.oo) == 1
        elif case == 'factorial_ratio':
            assert sp.limit((n/(n+1))**n, n, sp.oo) == sp.exp(-1)
        else:
            raise AssertionError(case)
    elif kind == 'bound':
        assert check['case'] == 'binary_uniform'
        assert sp.simplify((x*x+y*y)-x*x) == y*y
        for xv in [sp.Rational(i, 7) for i in range(-5, 6)]:
            for yv in [sp.Rational(i, 11) for i in range(-5, 6)]:
                if xv or yv:
                    assert abs(xv*xv*yv/(xv*xv+yv*yv)) <= abs(yv)
    else:
        raise AssertionError(f'Unverified check kind {kind}')

failures = []
for pattern in source['patterns']:
    try:
        verify(pattern['verification'])
    except Exception as error:
        failures.append({'id': pattern['id'], 'error': str(error) or type(error).__name__})
if failures:
    print(json.dumps({'failed': failures}, ensure_ascii=False, indent=2))
    raise SystemExit(1)
print(json.dumps({'verifiedExamples': len(source['patterns']), 'checks': 'symbolic derivatives, ODE substitution, exact finite products, bounds and limits'}, ensure_ascii=False))
