# Independent derivative and quadrature verification. Run from project root.
import json,sympy as s
from pathlib import Path
x=s.symbols('x',positive=True);a=s.symbols('a',positive=True)
exp,log,sqrt,sin,cos,tan,atan,asin,sec=s.exp,s.log,s.sqrt,s.sin,s.cos,s.tan,s.atan,s.asin,s.sec
# Independent original-integrand/candidate-primitive pairs, checked by differentiation.
pairs={
108:(x*exp(x),exp(x)*(x-1)),109:(tan(x),-log(cos(x))),110:(x**2*exp(x),exp(x)*(x**2-2*x+2)),111:(x*log(x),x**2*log(x)/2-x**2/4),112:(sec(x)**3,(sec(x)*tan(x)+log(sec(x)+tan(x)))/2),113:(x*sin(x),-x*cos(x)+sin(x)),115:(tan(x)**2,tan(x)-x),116:(asin(x),x*asin(x)+sqrt(1-x*x)),117:(x*x*exp(2*x),exp(2*x)*(x*x/2-x/2+s.Rational(1,4))),118:(1/x,log(x)),119:(exp(x)*sin(x),exp(x)*(sin(x)-cos(x))/2),120:(exp(sqrt(x)),2*exp(sqrt(x))*(sqrt(x)-1)),123:(1/(3+2*x),log(3+2*x)/2),124:((x**3+2*x)*sin(x),(3*x*x-4)*sin(x)-(x**3-4*x)*cos(x)),125:(1/(1+cos(2*x)),tan(x)/2),126:(1/(1+x*x)**2,atan(x)/2+x/(2*(1+x*x))),127:((x+1)/(x*x-5*x+6),4*log(x-3)-3*log(x-2)),128:(1/(x**4*(x*x+1)),-1/(3*x**3)+1/x+atan(x)),129:(sqrt(x-1)/x,2*sqrt(x-1)-2*atan(sqrt(x-1))),130:(sqrt(a*a-x*x),a*a*asin(x/a)/2+x*sqrt(a*a-x*x)/2),131:(1/(1+sqrt(2*x)),sqrt(2*x)-log(1+sqrt(2*x))),132:(x**4/(1+x*x),x**3/3-x+atan(x)),133:((x**3+1)/(x*(x-1)**3),-log(x)+2*log(x-1)-1/(x-1)-1/(x-1)**2),134:(1/((2*x+1)*(x*x+1)),2*log(2*x+1)/5-log(x*x+1)/5+atan(x)/5),135:(1/(sin(x)**2*cos(x)**2),tan(x)-s.cot(x)),136:(x**3/(x*x-2*x+2)**2,log(x*x-2*x+2)/2+2*atan(x-1)-x/(x*x-2*x+2)),137:(1/(1+(x+2)**s.Rational(1,3)),3*(x+2)**s.Rational(2,3)/2-3*(x+2)**s.Rational(1,3)+3*log(1+(x+2)**s.Rational(1,3))),138:(x*sin(x)**2,x*x/4-x*sin(2*x)/4-cos(2*x)/8),139:(atan(exp(x))/exp(2*x),-(exp(-2*x)+1)*atan(exp(x))/2-exp(-x)/2),140:((2*x+2)/((x-1)*(x*x+1)**2),log(x-1)-log(x*x+1)/2-atan(x)+1/(x*x+1)),141:(1/(8-4*sin(x)+7*cos(x)),log((tan(x/2)-5)/(tan(x/2)-3))),143:(1/sqrt(x*x+a*a),log(x+sqrt(x*x+a*a))),144:((2*x*x+7*x-1)/(x**3+x*x-x-1),-3/(x+1)+2*log(x-1)),145:(1/sqrt(x*x-a*a),log(x+sqrt(x*x-a*a))),146:(1/(sqrt(x)+x**s.Rational(1,3)),2*sqrt(x)-3*x**s.Rational(1,3)+6*x**s.Rational(1,6)-6*log(1+x**s.Rational(1,6))),147:(1/(1+sqrt(x)+sqrt(x+1)),(sqrt(x)+sqrt(x+1))/2-log(sqrt(x)+sqrt(x+1))/2-1/(2*(sqrt(x)+sqrt(x+1)))+1/(4*(sqrt(x)+sqrt(x+1))**2)),148:(log(tan(x/2))/sin(x),log(tan(x/2))**2/2),149:((1+sin(x))/(sin(x)*(1+cos(x))),tan(x/2)**2/4+tan(x/2)+log(tan(x/2))/2),150:((1+2*x*x)*exp(x*x)/(2-3*x*exp(x*x)),-log(2-3*x*exp(x*x))/3),151:(cos(x)/(1+exp(sin(x))),sin(x)-log(1+exp(sin(x)))),152:(x*x/(x+2)**3,log(x+2)+4/(x+2)-2/(x+2)**2),153:(sqrt(a*a-x*x)/x**4,-(a*a-x*x)**s.Rational(3,2)/(3*a*a*x**3)),155:(1/(x**8*(1+x*x)),1/x-1/(3*x**3)+1/(5*x**5)-1/(7*x**7)+atan(x)),156:(x*s.diff(cos(x)-x*sin(x),x),-x*x*sin(x)),157:((4*sin(x)+3*cos(x))/(2*sin(x)-cos(x)),x+2*log(2*sin(x)-cos(x))),158:(exp(atan(sqrt(1+x)))/((2+x)*sqrt(1+x)),2*exp(atan(sqrt(1+x)))),160:(1/(x*(1+2*log(x))),log(1+2*log(x))/2),161:(1/(1+exp(x/2)+exp(x/3)+exp(x/6)),x-3*log(1+exp(x/6))-3*log(1+exp(x/3))/2-3*atan(exp(x/6))),163:(1/(a*a+x*x),atan(x/a)/a),164:(sin(x)**2*cos(x)**5,sin(x)**7/7-2*sin(x)**5/5+sin(x)**3/3),165:(x*s.diff(2*x*exp(x*x),x),(2*x*x-1)*exp(x*x)),166:(exp(3*sqrt(x))/sqrt(x),2*exp(3*sqrt(x))/3),169:(1/(x*x-a*a),log((x-a)/(x+a))/(2*a))}
p=Path('frontend/src/assets/practice/bank402/review-108-262.json');rows=json.loads(p.read_text(encoding='utf8'));byid={r['originalId']:r for r in rows}
exact=[]; numeric=[];failed=[]
for ident,(integrand,primitive) in pairs.items():
 delta=s.trigsimp(s.simplify(s.diff(primitive,x)-integrand))
 if delta==0:
  exact.append(ident); msg='附加符号核验：SymPy对所列原函数求导减去原始被积函数，化简恒为0（实定义域另按上述条件核对）。'
 else:
  errs=[]
  for val in [s.Rational(2,5),s.Rational(7,10),s.Rational(6,5)]:
   z=complex(s.N(delta.subs({x:val,a:2}),30));errs.append(abs(z))
  if max(errs)>1e-12:failed.append((ident,str(delta),errs));continue
  numeric.append(ident);msg='附加导数核验：符号形式存在分支/三角恒等化简差异，在x=0.4,0.7,1.2及a=2代回导数差均小于1e-12；实定义域与换元恒等式按上述推导核对。'
 byid[ident]['audit']['reasoning']+=' '+msg
print('symbolic exact',len(exact),exact);print('numeric identities',len(numeric),numeric);print('failed',failed)
assert not failed
# Reject a false original proof request without changing its identity into a new exercise.
r=byid[171]
r.update(disposition='blocked',entranceScenarioId=None,classificationReason='原题要求证明三者均为同一被积函数的原函数，但第三项导数相差1/2，原命题为假；不能使用原id悄改为辨错或补系数题。',blockers=['第三候选arctan√(x/(1-x))的导数为1/[2√(x-x²)]，不是1/√(x-x²)。需原题来源修订；若另行改编，应生成新id并显式关联原记录。'],question=None)
r['audit']={'status':'blocked','reasoning':'在0<x<1用链式法则：D[arctan√(x/(1-x))]=(1-x)·[1/(2√(x/(1-x))(1-x)²)]=1/[2√(x-x²)]。前两候选导数为1/√(x-x²)，故不能证明原断言。','originalAnswerVerdict':'corrected'}
# Verification reads review records but does not rewrite them.

import json,mpmath as m
from pathlib import Path
m.mp.dps=45
pi=m.pi;e=m.e
checks={
173:(lambda x:abs(2-x),[0,2,3],m.mpf(5)/2),174:(lambda x:x*m.exp(x),[0,1],1),175:(m.log,[1,5],5*m.log(5)-4),177:(lambda x:m.exp(m.sqrt(x)),[0,1],2),178:(lambda x:m.sin(m.log(x)),[1,e],(e*(m.sin(1)-m.cos(1))+1)/2),180:(lambda x:m.exp(-x),[0,m.inf],1),183:(lambda x:m.sqrt(2-x*x),[0,m.sqrt(2)],pi/2),184:(lambda x:m.log(x)/x**3,[1,e],m.mpf(1)/4-3/(4*e**2)),185:(lambda x:m.cos(x/2)**5,[0,pi],m.mpf(16)/15),187:(lambda x:m.sqrt(2)*m.sin(x),[0,pi],2*m.sqrt(2)),188:(lambda x:(x+2)/m.sqrt(2*x+1),[0,4],m.mpf(22)/3),189:(lambda x:m.asin(m.sqrt(x/(1+x))),[0,3],4*pi/3-m.sqrt(3)),190:(lambda x:(1-m.sqrt(x))**3,[0,1],m.mpf(1)/10),191:(lambda x:1/(4+x*x),[-2,2*m.sqrt(3)],7*pi/24),192:(lambda x:m.cos(x)**5*m.sin(x),[0,pi/2],m.mpf(1)/6),193:(lambda x:m.sqrt(m.exp(x)-1),[0,m.log(2)],2-pi/2),194:(lambda x:1/(1+x*x),[-m.inf,0,m.inf],pi),196:(lambda x:1/m.sqrt(4-x*x),[0,2],pi/2),199:(lambda x:(x+abs(x))/(2+x*x),[-2,0,2],m.log(3)),200:(lambda x:1/m.sqrt(x*(x+1)**3),[0,1,m.inf],2),201:(lambda x:x*m.exp(-2*x),[0,m.inf],m.mpf(1)/4),202:(lambda x:(2*x*x+x*m.cos(x))/(1+m.sqrt(1-x*x)),[-1,0,1],4-pi),204:(lambda x:x**6/(1-x**6)**(m.mpf(1)/6),[0,1],pi/18),206:(lambda x:1/(x*m.sqrt(1+x**5+x**10)),[1,m.inf],m.log((3+2*m.sqrt(3))/3)/5),207:(lambda x:m.tan(x)**(m.mpf(2)/3),[0,pi/4,pi/2],pi),208:(lambda x:abs(m.sin(x))*m.sqrt(m.cos(x)),[-pi/2,0,pi/2],m.mpf(4)/3),209:(lambda x:1/(x*(x**3+1)),[1,m.inf],m.log(2)/3),210:(lambda x:x/((2+x*x)*m.sqrt(1+x*x)),[0,m.inf],pi/4),211:(lambda x:1/(x*m.sqrt(m.log(x)*(1-m.log(x)))),[m.sqrt(e),e**(m.mpf(3)/4)],pi/6),215:(lambda x:m.cos(x)/(1+m.exp(x)),[-pi/2,0,pi/2],1),219:(lambda t:m.sin(t)/m.sqrt(1-4*m.cos(t)+4),[0,pi],1),241:(lambda x:m.cos(x)**4*m.log(x+m.sqrt(4+x*x)),[-pi/2,0,pi/2],3*pi*m.log(2)/8),246:(lambda x:m.sqrt(x)-x*x,[0,1],m.mpf(1)/3),248:(lambda t:8*m.cos(t)**2,[-pi/2,pi/2],4*pi),250:(lambda y:12*pi*m.sqrt(1-y*y),[-1,0,1],6*pi*pi),251:(lambda y:2*m.sqrt(y),[0,1],m.mpf(4)/3),253:(lambda y:4*pi*m.sqrt(1-y*y),[0,1],pi*pi),254:(lambda t:2*(1+m.cos(t))**2,[0,2*pi],6*pi),258:(lambda t:2*t*t,[0,2*pi],16*pi**3/3),260:(lambda x:abs(m.log(x)),[m.mpf(1)/2,1,2],3*m.log(2)/2-m.mpf(1)/2),261:(lambda x:2*m.sqrt(1+m.mpf(3)/2*(x-1)),[1,2],m.mpf(8)/9*((m.mpf(5)/2)**(m.mpf(3)/2)-1)),262:(lambda z:pi*(4-(4-9)*z*z/16),[-4,0,4],2*pi*4*(8+9)/3)}
p=Path('frontend/src/assets/practice/bank402/review-108-262.json');rows=json.loads(p.read_text(encoding='utf8'));byid={r['originalId']:r for r in rows}
fail=[]
for ident,(fn,bounds,expected) in checks.items():
 actual=m.quad(fn,bounds);err=abs(actual-expected)
 # Integrable algebraic endpoint singularities converge more slowly under tanh-sinh; comparison tolerance chosen separately.
 tol=m.mpf('1e-12') if ident==207 else m.mpf('1e-20')
 if err>tol:fail.append((ident,str(actual),str(expected),str(err)))
 else:byid[ident]['audit']['reasoning']+=' 附加数值核验：45位mpmath按上述积分式计算，含参数题代入一个合法样本，结果与所列解析值差小于'+str(tol)+'；数值检查仅作独立旁证。'
print('mpmath checks',len(checks),'failures',fail)
assert not fail
# Parameter recurrence and asymmetric limit signs independently checked.
import sympy as s
x,a,b,n=s.symbols('x a b n')
identity=s.diff(x/(a*x*x+b)**(n-1),x)-((3-2*n)/(a*x*x+b)**(n-1)+2*b*(n-1)/(a*x*x+b)**n)
assert all(s.simplify(identity.subs(n,k))==0 for k in [2,3,4,5])
byid[142]['audit']['reasoning']+=' 附加符号核验：递推使用的D[x/(ax²+b)^(n-1)]恒等式在n=2,3,4,5由SymPy化简差为0；一般实n按上面的求导推导核对，b=0分支另列。'
for sign in [1,-1]:
 v=m.mpf(sign)*m.mpf('0.0001')
 numerator=m.quad(lambda t:t*(m.tan(t)-t),[0,m.tan(v)])
 denominator=m.quad(lambda t:m.sin(t)**(m.mpf(3)/2),[0,m.sin(v)**2])
 assert abs(numerator/denominator-m.mpf(sign)/6)<m.mpf('1e-7')
byid[226]['audit']['reasoning']+=' 附加数值核验：x=±10^-4时商分别接近±1/6（偏差<10^-7），验证单侧符号差异。'
# Verification reads review records but does not rewrite them.
report={'symbolicDerivativeExactIds':exact,'numericalDerivativeIds':numeric,'quadratureIds':sorted(checks),'symbolicRecurrence142Samples':[2,3,4,5],'oneSidedLimit226':{'right':'1/6','left':'-1/6','samples':['1e-4','-1e-4']},'failures':[],'scope':'SymPy and mpmath are independent mathematical evidence; all real domains, branches, improper limits and missing inputs are reviewed separately.'}
Path('frontend/src/assets/practice/bank402/math-check-108-262.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
