"""Auxiliary exact checks; these do not replace the item-by-item proofs in review JSON."""
import json, hashlib
from pathlib import Path
import sympy as s
base=Path(__file__).resolve().parents[5]
source=base/'高数题库-402道/question-bank.jsonl'
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
x=s.symbols('x',real=True)
a,b=s.symbols('a b',real=True)
checks=[]
def check(i,label,actual,expected):
    assert s.simplify(actual-expected)==0,(i,label,actual,expected)
    checks.append({'originalId':i,'check':label,'computed':str(actual),'expected':str(expected)})
check(19,'symmetric square-root cancellation',s.limit((s.sqrt(1+x)+s.sqrt(1-x)-2)/x**2,x,0),-s.Rational(1,4))
check(26,'tan minus sin cubic cancellation',s.limit((s.tan(x)-s.sin(x))/s.log(1+x**3),x,0),s.Rational(1,2))
check(33,'cube root at nonzero base point',s.limit((s.tan(x)**s.Rational(1,3)-1)/(2*s.sin(x)**2-1),x,s.pi/4),s.Rational(1,3))
check(50,'tenth derivative by symbolic differentiation',s.diff(x**2*s.exp(-x),x,10),s.exp(-x)*(x**2-20*x+90))
check(56,'sixth-power trigonometric identity',s.expand_trig(s.sin(x)**6+s.cos(x)**6-(s.Rational(5,8)+s.Rational(3,8)*s.cos(4*x))),0)
check(70,'implicit second derivative after chain factor',s.diff(2/(2-s.cos(x)),x)*2/(2-s.cos(x)),-4*s.sin(x)/(2-s.cos(x))**3)
check(79,'first-order absolute error',s.pi*s.Rational('60.03')*s.Rational('0.05')/2,s.Rational('1.50075')*s.pi)
check(88,'exponential second Taylor coefficient',s.diff(s.exp(2*x),x,2).subs(x,0)/s.factorial(2),2)
check(91,'second inflection ordinate',(3*x**4-4*x**3+1).subs(x,s.Rational(2,3)),s.Rational(11,27))
check(92,'global candidate value',(x*x-54/x).subs(x,-3),27)
f=x-(a+b*s.cos(x))*s.sin(x)
coeff1=s.diff(f,x).subs(x,0)
coeff3=s.diff(f,x,3).subs(x,0)
sol=s.solve([coeff1,coeff3],[a,b])
assert sol=={a:s.Rational(4,3),b:-s.Rational(1,3)},sol
check(95,'nonzero fifth coefficient under solved parameters',(s.diff(f,x,5)/s.factorial(5)).subs(x,0).subs(sol),s.Rational(1,30))
check(96,'fourth-order cosine exponential cancellation',s.limit((s.cos(x)-s.exp(-x*x/2))/s.sin(x)**4,x,0),-s.Rational(1,12))
check(97,'hundredth derivative at zero',s.diff((1+x*x)*s.exp(x),x,100).subs(x,0),9901)
check(44,'counterexample f=x has nonzero derivative limit',s.limit(s.diff(x,x),x,s.oo),1)
check(46,'counterexample derivative residual',s.diff(s.exp(-x)-x,x)+s.exp(-x),-1)
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
result={'purpose':'辅助符号核对，不代表自动证明全部题目','checks':checks,'checked':len(checks),'sourceSha256':source_hash,'sourcePreserved':True}
(Path(__file__).parent/'math-check-001-107.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checked':len(checks),'sourcePreserved':True},ensure_ascii=False))
