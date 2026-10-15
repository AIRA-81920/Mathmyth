"""Reproduce selected mathematical checks for reviewed bank402 ids 263-402.

Requires the already available SymPy; installs nothing and does not modify
application code or original records. Run from any directory with Python.
This is a selected-check report, not a proof certificate for all 101 questions.
"""
import json
from pathlib import Path
import sympy as sp

x, y, t, C, a, k, m, g, v = sp.symbols('x y t C a k m g v', real=True)
positive_y = sp.symbols('y', positive=True)
checks = []


def check(record_id, label, actual, expected=0):
    difference = sp.simplify(actual - expected)
    checks.append({
        'originalId': record_id,
        'check': label,
        'actual': str(sp.simplify(actual)),
        'expected': str(expected),
        'residual': str(difference),
        'passed': difference == 0,
    })
    if difference != 0:
        raise AssertionError(f'{record_id}: {label}: residual {difference}')


# Substitution into the literal differential equations, not their source answers.
f = -1 / (x*x+C)
check(264, 'Nonzero branch residual yprime-2xy²', sp.diff(f, x)-2*x*f*f)
check(264, 'Zero branch residual', 0)
f = C*sp.exp(x*x)
check(265, 'General solution residual', sp.diff(f,x)-2*x*f)
f = x*sp.log(x)+C*x  # x>0 chart; log(abs(x)) gives same local equation for x<0.
check(266, 'Positive-x chart residual', sp.diff(f,x)-f/x-1)
F = sp.atan(y/x)-sp.log(x*x+y*y)/2
check(267, 'First-integral directional residual', sp.diff(F,x)+sp.diff(F,y)*(x+y)/(x-y))
check(267, 'Exact-form x coefficient', sp.diff(F,x), -(x+y)/(x*x+y*y))
check(267, 'Exact-form y coefficient', sp.diff(F,y), (x-y)/(x*x+y*y))
X = positive_y**2*(C-sp.log(positive_y))
check(268, 'Inverse-function linear residual', sp.diff(X,positive_y)-2*X/positive_y+positive_y)
X2 = positive_y**2*(2*sp.log(positive_y)+1)
check(269, 'Squared-coordinate linear residual', sp.diff(X2,positive_y)-2*X2/positive_y-2*positive_y)
check(269, 'Initial squared-coordinate value', X2.subs(positive_y,1), 1)
f = (x+1)**2*(sp.Rational(2,3)*(x+1)**sp.Rational(3,2)+C)
check(270, 'ODE residual on x>-1', (x+1)*sp.diff(f,x)-2*f-(x+1)**sp.Rational(7,2))
f = 1/(x*(C-a*sp.log(x)**2/2))
check(272, 'Nonzero Bernoulli solution residual on x>0', sp.diff(f,x)+f/x-a*sp.log(x)*f*f)
f = x*x+1
check(273, 'Slope equation residual', sp.diff(f,x)-2*x)
check(273, 'Point condition', f.subs(x,1), 2)
for basis in [sp.exp(-x/2)*sp.cos(sp.sqrt(3)*x/2), sp.exp(-x/2)*sp.sin(sp.sqrt(3)*x/2)]:
    check(274, 'Real homogeneous basis residual', sp.diff(basis,x,2)+sp.diff(basis,x)+basis)
for record_id, particular, coef_d, coef_y, rhs in [
    (275, sp.exp(x)/9, 4, 4, sp.exp(x)),
    (283, (4*x-16)*sp.exp(x), 2, -2, 4*x*sp.exp(x)),
    (285, (sp.cos(x)-3*sp.sin(x))/10, -3, 2, sp.cos(x)),
]:
    check(record_id, 'Particular-solution substitution residual',
          sp.diff(particular,x,2)+coef_d*sp.diff(particular,x)+coef_y*particular-rhs)
for basis in [sp.exp(-2*x), x*sp.exp(-2*x)]:
    check(275, 'Repeated-root homogeneous basis residual', sp.diff(basis,x,2)+4*sp.diff(basis,x)+4*basis)
f = m*g/k*(1-sp.exp(-k*t/m))
check(276, 'Newton equation residual', m*sp.diff(f,t)-m*g+k*f)
check(276, 'Initial velocity', f.subs(t,0))
f = a*sp.cos(k*t)+C*sp.sin(k*t)
check(277, 'Literal candidate-function residual', sp.diff(f,t,2)+k*k*f)
f = x-sp.log(x)+C
check(278, 'Literal equation residual on positive-x chart', sp.diff(f,x)+1/x-1)
bad278 = x*(C+sp.log(x))
checks.append({'originalId':278,'check':'Source answer rejection',
               'sourceResidual':str(sp.simplify(sp.diff(bad278,x)+1/x-1)),
               'passed':sp.simplify(sp.diff(bad278,x)+1/x-1)!=0})
X = C*sp.exp(y)-y-1
check(279, 'First equation inverse linear residual', sp.diff(X,y)-X-y)
z = C/x**3-1/(2*x)
check(279, 'Second equation reciprocal-exponential residual', sp.diff(z,x)+3*z/x+1/x**2)
f = sp.log(sp.exp(x)/(2-sp.exp(x)))
check(282, 'Nonlinear second-order equation residual', sp.diff(f,x,2)-sp.exp(2*f)-sp.exp(f))
check(282, 'Initial function value', f.subs(x,0))
check(282, 'Initial derivative value', sp.diff(f,x).subs(x,0), 2)
for root in [-1+sp.sqrt(3),-1-sp.sqrt(3)]:
    check(283, 'Correct characteristic root', root*root+2*root-2)
f = sp.sqrt(x+1)
check(286, 'Reduced nonlinear ODE residual', f*sp.diff(f,x,2)+sp.diff(f,x)**2)
check(286, 'Initial function', f.subs(x,0), 1)
check(286, 'Initial derivative', sp.diff(f,x).subs(x,0), sp.Rational(1,2))
f = sp.sinh(x)
check(288, 'Linear modeled equation residual', sp.diff(f,x)+f-sp.exp(x))
check(288, 'Original area identity', sp.integrate(sp.sinh(t),(t,0,x))-(sp.exp(x)-1-f))

# Selected multivariable formulas and exact parameter calculation.
check(322, 'Full differential y coefficient', sp.diff(x+sp.sin(y/2)+sp.exp(y*sp.Symbol('z')),y),
      sp.cos(y/2)/2+sp.Symbol('z')*sp.exp(y*sp.Symbol('z')))
f = sp.exp(x*y)*sp.sin(x+y)
check(328, 'Corrected x partial', sp.diff(f,x), sp.exp(x*y)*(y*sp.sin(x+y)+sp.cos(x+y)))
check(328, 'Completed y partial', sp.diff(f,y), sp.exp(x*y)*(x*sp.sin(x+y)+sp.cos(x+y)))
f = sp.log(x*x+y*y)/2
check(331, 'Two-dimensional Laplacian away from origin', sp.diff(f,x,2)+sp.diff(f,y,2))
rho = x*x+y*y
M,N = x/(y*sp.sqrt(rho)), -x*x/(y*y*sp.sqrt(rho))
check(357, 'Cross-partials at lambda=-1/2', sp.diff(M,y)-sp.diff(N,x))
Phi = sp.sqrt(rho)/y
check(357, 'Potential x derivative', sp.diff(Phi,x), M)
check(357, 'Potential y derivative', sp.diff(Phi,y), N)
bad = sp.simplify(sp.diff(x*sp.sqrt(rho)/y,y)-sp.diff(-x*x*sp.sqrt(rho)/(y*y),x))
checks.append({'originalId':357,'check':'Reject lambda=+1/2 source fragment',
               'sourceResidual':str(bad),'passed':bad!=0})

# Definite integrations recompute coefficients and geometric totals.
check(340, 'Split plane-area integral', sp.integrate(x/sp.E,(x,0,1))+sp.integrate(x/sp.E-sp.log(x),(x,1,sp.E)), sp.E/2-1)
check(342, 'Changed-order integral', sp.integrate(y**3*sp.cos(y*y),(y,0,1)), (sp.sin(1)+sp.cos(1)-1)/2)
r,theta = sp.symbols('r theta',positive=True)
check(343, 'Polar volume', 2*sp.pi*sp.integrate(((2*a-r)-r*r/a)*r,(r,0,a)),5*sp.pi*a**3/6)
inner = sp.integrate(r**3,(r,0,1))*sp.integrate(sp.cos(theta)*sp.sin(theta),(theta,0,sp.pi/2))
outer = 2*sp.integrate(r**4,(r,1,sp.sqrt(2)))*sp.integrate(sp.cos(theta)**2*sp.sin(theta),(theta,0,sp.pi/2))
check(347, 'Literal multiplication: inner k=1 disk',inner,sp.Rational(1,8))
check(347, 'Literal multiplication: outer k=2 annulus',outer,sp.Rational(2,15)*(4*sp.sqrt(2)-1))
check(347, 'Literal multiplication: total matches source answer',inner+outer,sp.Rational(1,8)+sp.Rational(2,15)*(4*sp.sqrt(2)-1))
# If a y exponent were silently supplied, the second piece would differ.
exponent_outer = sp.integrate(r**5,(r,1,sp.sqrt(2)))*sp.integrate(sp.cos(theta)**2*sp.sin(theta)**2,(theta,0,sp.pi/2))
checks.append({'originalId':347,'check':'Alternative y-exponent reading rejected',
               'literalOuter':str(outer),'hypotheticalExponentOuter':str(exponent_outer),
               'passed':sp.simplify(outer-exponent_outer)!=0})
disk = 2*sp.pi*sp.integrate(r**3,(r,0,1))
check(351, 'Horizontal cap contribution',disk,sp.pi/2)
check(351, 'Cone lateral contribution',sp.sqrt(2)*disk,sp.sqrt(2)*sp.pi/2)
check(351, 'Whole closed surface includes both pieces', (1+sp.sqrt(2))*disk,sp.pi*(1+sp.sqrt(2))/2)
P,Q,R = sp.Symbol('z')**2,x*x+x*y-x,2*x*sp.Symbol('z')
check(354, 'Stokes curl z-component',sp.diff(Q,x)-sp.diff(P,y),2*x+y-1)
check(356, 'Constant curl dotted into chosen positive-x normal',(-2-2-2)/sp.sqrt(3),-2*sp.sqrt(3))
check(367, 'Integrated arctan sum value',sp.integrate(sp.atan(x),(x,0,1)),sp.pi/4-sp.log(2)/2)

# Necessary first-/second-order extrema and implicit derivative values.
z = x*x*y*(3-x-y)
check(390, 'Interior x stationary condition',sp.diff(z,x).subs({x:sp.Rational(3,2),y:sp.Rational(3,4)}))
check(390, 'Interior y stationary condition',sp.diff(z,y).subs({x:sp.Rational(3,2),y:sp.Rational(3,4)}))
check(390, 'Interior candidate maximum value',z.subs({x:sp.Rational(3,2),y:sp.Rational(3,4)}),sp.Rational(81,64))
edge = z.subs(y,4-x)
check(390, 'Slanted boundary stationary derivative',sp.diff(edge,x).subs(x,sp.Rational(8,3)))
check(390, 'Slanted boundary minimum value',edge.subs(x,sp.Rational(8,3)),-sp.Rational(256,27))
yp = 1/(1-a*sp.cos(y))
check(394, 'Implicit second derivative via chain rule',sp.diff(yp,y)*yp,-a*sp.sin(y)/(1-a*sp.cos(y))**3)

report = {
    'scope': 'Selected symbolic substitution/integration checks; no claim that every published record has automated proof.',
    'method': 'SymPy simplification of independently entered equations, derivatives and integrals.',
    'sympyVersion': sp.__version__,
    'distinctOriginalIdsChecked': len({item['originalId'] for item in checks}),
    'assertionCount': len(checks),
    'passed': all(item['passed'] for item in checks),
    'checks': checks,
}
output = Path(__file__).resolve().parents[1] / 'src/assets/practice/bank402/math-checks-263-402.json'
output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:report[key] for key in ['distinctOriginalIdsChecked','assertionCount','passed']},ensure_ascii=False))
