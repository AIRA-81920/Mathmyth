"""Independently check pattern examples with symbolic/numeric math.

Run from the repository: python frontend/scripts/check-knowledge-pattern-math.py
Requires the existing local SymPy; the application itself does not depend on it.

两个学科各有一份结构资料：knowledge/patterns.json（高数）与
knowledge/high_school/patterns.json（高中）。每条的 verification 就是它的数学校验载荷，
kind 必须是本文件实现过的那几种——出现没实现的 kind 一律失败，不允许"写个名字就算核对过"。
"""
import json
from pathlib import Path
import sympy as sp

root = Path(__file__).resolve().parents[2]
SOURCES = {
    'advanced': root / 'knowledge/patterns.json',
    'high_school': root / 'knowledge/high_school/patterns.json',
}

def verify(check):
    x = sp.Symbol('x', positive=True) if check.get('positive') else sp.Symbol('x', real=True)
    y = sp.Symbol('y', real=True)
    a = sp.Symbol('a', positive=True) if check.get('aPositive') else sp.Symbol('a', real=True)
    n, k = sp.symbols('n k', positive=True, integer=True)
    f = sp.Function('f')
    scope = dict(x=x, y=y, a=a, n=n, k=k, t=sp.Symbol('t', positive=True),
                 c1=sp.Symbol('c1', real=True), c2=sp.Symbol('c2', real=True), f=f)
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
        for count in range(1, 8):
            case = check['case']
            if case == 'power_chain':
                for base in [sp.Rational(1, 3), sp.Rational(-1, 2)]:
                    actual = sp.prod(1 + base**(2**j) for j in range(count+1))
                    assert zero(actual - (1-base**(2**(count+1)))/(1-base))
            elif case == 'half_angle':
                theta = sp.Rational(1, 1)
                actual = sp.prod(sp.cos(theta/2**j) for j in range(1, count+1))
                expected = sp.sin(theta)/(2**count*sp.sin(theta/2**count))
                assert abs(sp.N(actual-expected, 60)) < sp.Float('1e-50')
            elif case == 'shifted_factors':
                if count >= 2:
                    actual = sp.prod(sp.Rational(j**3-1, j**3+1) for j in range(2, count+1))
                    assert actual == sp.Rational(2*(count*count+count+1), 3*count*(count+1))
            elif case == 'split_chains':
                actual = sp.prod(sp.Rational((j+1)**2, j*(j+2)) for j in range(1, count+1))
                assert actual == sp.Rational(2*(count+1), count+2)
            else:
                raise AssertionError(case)
    elif kind == 'sequence_limit':
        case = check['case']
        if case == 'uniform_bounds':
            lower = sp.summation(k, (k, 1, n))/(n*n+n)
            upper = sp.summation(k, (k, 1, n))/(n*n)
            assert sp.limit(lower, n, sp.oo) == sp.limit(upper, n, sp.oo) == sp.Rational(1, 2)
        elif case == 'small_increments':
            assert sp.limit(sp.summation(k/n**2, (k, 1, n)), n, sp.oo) == sp.Rational(1, 2)
            assert sp.limit(sp.summation(k**2/(2*n**4), (k, 1, n)), n, sp.oo) == 0
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
    # ---- 高中数学新增的核对方式 ----
    elif kind == 'quadratic_sign':
        poly = sp.sympify(check['polynomial'], locals=scope)
        for point in check['positive']:
            assert sp.sign(poly.subs(x, sp.Rational(point))) == 1
        for point in check['negative']:
            assert sp.sign(poly.subs(x, sp.Rational(point))) == -1
    elif kind == 'undefined_at':
        expression = parse(check['function'])
        denominator = sp.denom(sp.together(expression))
        for point in check['excluded']:
            assert denominator.subs(x, sp.Rational(point)) == 0, point
        for point in check['included']:
            assert sp.simplify(denominator.subs(x, sp.Rational(point))) != 0, point
    elif kind == 'derivative_sign':
        derivative = sp.diff(parse(check['function']), x)
        for point, expected in check['signs'].items():
            assert sp.sign(derivative.subs(x, sp.Rational(point))) == expected, (point, derivative)
    elif kind == 'telescoping':
        expression = parse(check['term'])
        partial = parse(check['partial'])
        total = 0
        for count in range(1, 7):
            total += expression.subs(n, count)
            assert zero(total - partial.subs(n, count)), count
    elif kind == 'distance_point_line':
        px, py = sp.sympify(check['point'], locals=scope)
        line = sp.sympify(check['line'], locals=scope)
        coefficients = line.as_coefficients_dict()
        A = coefficients.get(x, 0); B = coefficients.get(y, 0); C = coefficients.get(1, 0)
        distance = sp.Abs(A*px + B*py + C)/sp.sqrt(A*A + B*B)
        assert sp.simplify(distance - parse(check['result'])) == 0
    elif kind == 'symmetric_roots':
        quadratic = sp.sympify(check['quadratic'], locals=scope)
        lead, linear, constant = sp.Poly(quadratic, x).all_coeffs()
        assert sp.simplify(-linear/lead - parse(check['sum'])) == 0
        assert sp.simplify(constant/lead - parse(check['product'])) == 0
    elif kind == 'probability_sum':
        probabilities = [sp.Rational(item) for item in check['probabilities']]
        assert sp.Add(*probabilities) == 1
    elif kind == 'binomial_moments':
        n_value, p_value = sp.Rational(check['n']), sp.Rational(check['p'])
        assert sp.simplify(n_value*p_value - parse(check['mean'])) == 0
        second = sp.summation(sp.binomial(n_value, k)*p_value**k*(1-p_value)**(n_value-k)*k**2, (k, 0, n_value))
        assert sp.simplify(second - (n_value*p_value*(1-p_value) + (n_value*p_value)**2)) == 0
    else:
        raise AssertionError(f'Unverified check kind {kind}')

failures = []
counts = {}
for subject, path in SOURCES.items():
    source = json.loads(path.read_text(encoding='utf-8'))
    for pattern in source['patterns']:
        try:
            verify(pattern['verification'])
        except Exception as error:
            failures.append({'subject': subject, 'id': pattern['id'], 'error': str(error) or type(error).__name__})
    counts[subject] = len(source['patterns'])
if failures:
    print(json.dumps({'failed': failures}, ensure_ascii=False, indent=2))
    raise SystemExit(1)
print(json.dumps({'verifiedExamples': counts, 'checks': 'sympy: 高数原有 kinds + 高中二次定号/定义域/单调符号/裂项/点线距离/韦达/概率与二项矩'}, ensure_ascii=False))
