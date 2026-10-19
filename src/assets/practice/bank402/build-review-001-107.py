import json,re,subprocess
from pathlib import Path
base=Path(__file__).resolve().parents[5]
src=[json.loads(x) for x in (base/'高数题库-402道/question-bank.jsonl').read_text(encoding='utf-8').splitlines()]
old={x['metadata']['source']['originalId']:x for x in json.loads(subprocess.run(['node','--input-type=module','-e',"import {firstBatchTargets} from './frontend/src/assets/practice/route-bank.js';console.log(JSON.stringify(firstBatchTargets.flatMap(t=>t.questions).filter(q=>q.metadata.source.originalId)))"],cwd=base,check=True,capture_output=True,encoding='utf-8').stdout)}
out={}
def norm(t):
    t=re.sub(r'\\tk\{(?:[^{}]|\{[^{}]*\})*\}', '',t)
    return t.replace(' arrow',r'\to').strip()
def blocked(i,why,s=None):
    x=src[i-1];out[i]=dict(originalId=i,disposition='blocked',normalizedQuestion=norm(x['text']),entranceScenarioId=s,classificationReason=why,blockers=[why],audit={'status':'blocked','reasoning':why,'originalAnswerVerdict':'unverified'},question=None)
def duplicate(i,j,s,why):
    x=src[i-1];out[i]=dict(originalId=i,disposition='duplicate',duplicateOf=j,normalizedQuestion=norm(x['text']),entranceScenarioId=s,classificationReason=why,blockers=[f'重复题不再次发布：已由原题{j}承接。'],audit={'status':'checked','reasoning':why,'originalAnswerVerdict':'corrected'},question=None)
def add(i,s,m,sol,main,bad1,bad2,condition,structure=None,audit=None,verdict='retained',question=None):
    x=src[i-1];face=question or norm(x['text'])
    def route(k,text,valid):
        return dict(id='r-'+str(k),summary=text,valid=valid,preferred=k==0,condition=condition,reason=main if valid else text,steps=[dict(scenarioId=s,methodId=m,state=face,transformedState=sol if valid else text,condition=condition)],**({} if valid else {'failedStep':0}))
    q=dict(format='route-v1',entranceScenarioId=s,question=face,solution=sol,routes=[route(0,main,True),route(1,bad1,False),route(2,bad2,False)],structure=structure or {'op':'derivative' if '.deriv.' in s else 'proof' if '.mvt.' in s else 'limit','args':[{'op':'var'},{'op':'const'}]},variables=['x','y','a','b','n','t','h','c','p','q'],comparisonCriterion=main,metadata=dict(motherId=f'candidate.bank402.{i}',source=dict(kind='dataset_import',originalId=i,reference=x['source'],ref=x['source'],label=f'原题库第{i}题'),originalRecord=x,reviewStatus='worked_example_checked',userApprovedClassic=False,trainingGoal=main,invariants=['保留原题条件与所问，参数的实数定义域须检查','给定路线独立检查适用条件'],allowedVariations=['改变常数后重新核对答案与失效路线'],contentVersion=1,answerAudit=dict(originalAnswerIsReference=False,normalization='删除填空答案宏；arrow还原为to；原始行完整保存')))
    out[i]=dict(originalId=i,disposition='ready',normalizedQuestion=face,entranceScenarioId=s,classificationReason=main,blockers=[],audit={'status':'checked','reasoning':audit or sol,'originalAnswerVerdict':verdict},question=q)
Z='S.limit.0over0';I='S.limit.inf_over_inf';P='S.limit.one_to_inf';N='S.limit.n_term_sum';D='S.limit.discontinuity_classification';C='S.limit.piecewise_continuity';O='S.limit.infinitesimal_order';R='S.limit.recurrence_sequence'
H='S.deriv.higher_order';E='S.deriv.composite_derivative';A='S.deriv.abstract_function';F='S.deriv.implicit_derivative';L='S.deriv.differential_approx';T='S.deriv.tangent_normal';W='S.deriv.power_exponential'
U='S.mvt.monotonicity_extremum';B='S.mvt.max_min_application';J='S.mvt.inequality_proof';K='S.mvt.rolle_equality';Y='S.mvt.lagrange_cauchy_equality';Q='S.mvt.concavity_inflection'
def row(i,s,m,sol,main,b1,b2,cond='在原题给定定义域与趋近方向内计算。',**kw):add(i,s,'M.'+m,sol,main,b1,b2,cond,**kw)
for i,why,s in [
 (2,'题面未提供F的分段表达式；原答案明确凭常见模型猜补，不能采用。',C),
 (4,'未给F或F′的表达式，答案只有截断的enumerate。',C),
 (5,'只有I_n极限等于0的结论片段，未定义I_n且没有待求或待证目标。',N),
 (11,'题面止于“证明：”，证明目标缺失；不能用原答案推测目标。',Y),
 (15,'只给f(x)等于正弦级数，未说明求和/收敛/展开等所问；应归傅里叶而非极限。','S.series.fourier_series'),
 (22,'n arrow后趋近目标缺失；G与G_n记号不一致，需恢复原题。',N),
 (35,'仅给幂级数和分段答案恒等式，没有所问；所给闭式在x=0还重叠出现除零。应归幂级数求和。','S.series.summation_function'),
 (36,'题面是解答链条且第一商与第二商不相等：tan x sin x/(e^(x³)−1)~1/x，两侧无共同有限极限；不能猜改sin x为1−cos x。',Z),
 (38,'题面声称全体平方倒数和=π²/8为假；给定傅里叶关系仅推出奇数项和=π²/8，全体和=π²/6。须确认原待求式。','S.series.fourier_series'),
 (42,'要求使用(1)(2)而两项结论缺失；尽管交错调和级数求和可独立证明，不能冒充指定的证明。','S.series.summation_function'),
 (44,'命题缺必要前提而为假：f(x)=x可导且f′极限存在等于1，而非0；未给原函数有限极限等条件。',Y),
 (46,'完整但命题为假：f(x)=e^(−x)−x满足C¹、f≤e^(−x)、f(0)=1，却f′=−e^(−x)−1从不等于−e^(−x)。',K),
 (63,'举例结论片段未规定导数极限的趋近点/方向；原解答擅自选+∞。',D),
 (65,'只有切线与面积答案片段，没有曲线、切点与面积区域；原答案把单点切线斜率冒充处处导数。',T),
 (67,'未给隐函数/参数关系，原答案猜圆方程且二阶推导还漏常数2。',F),
 (77,'给出参数方程后止于“求下列极限：”，待求表达式缺失。','S.deriv.parametric_derivative'),
 (80,'仅有两项导数极限，没有y的定义或参数方程。','S.deriv.parametric_derivative'),
 (84,'止于“试证明：”，待证结论缺失；不能猜补。',Y),
]:blocked(i,why,s)
row(1,C,'one_sided_limit',r'在x≠0的两区间，1/x与cos均连续，复合连续。x=0不在定义域，且取x_n=1/(2πn)、z_n=1/((2n+1)π)，函数值分别为1、−1，故无两侧极限、不可连续延拓。','先检查定义域，再用两条趋零数列检查0点','把cos有界当作x→0时有极限；两列值1与−1反驳此结论。','把cos(1/x)在0写成cos∞=0；∞不是可以代入三角函数的实数。','x≠0；两条数列均趋0。',verdict='corrected')
row(3,D,'one_sided_limit',r'左极限为−∞，右极限为+∞，0处未定义且无法有限连续延拓；按间断点分类属于第二类无穷间断点。','分别计算左右极限并检查是否有限','把右极限也写成−∞；x>0时1/x>0，与符号相矛盾。','称0为跳跃间断点；跳跃要求两个单侧极限均有限。','分别取x<0和x>0。',verdict='corrected')
row(6,Z,'important_limit',r'a>0时a^x=e^{x ln a}，(e^{x ln a}−1)/x→ln a；a=1商恒为0也符合公式。a≤0没有一般的实数邻域幂函数，不能讨论此实数两侧极限。','改写指数并保留ln a系数','令t=a^x−1并除ln a而不单独处理a=1；此时换元不再可逆。','把a^x−1等价成x，得到1；漏掉ln a，a=e²时结果应2。','实数幂函数须a>0；a=1单独处理。')
row(7,Z,'important_limit',r'log_a(1+x)=ln(1+x)/ln a，故极限1/ln a。','先换底再使用对数重要极限','把换底因子写成ln a而非1/ln a；a=e²时错误结果2。','用(1+x)^(1/x)→1来求极限；该极限为e。','a>0,a≠1,1+x>0。')
row(9,Z,'rationalization',r'乘共轭并约去x−4，商为2/(√(1+2x)+3)→1/3。','有理化消去x−4','直接代入得到0/0并认定结果0；0/0不是确定值。','有理化后把2(x−4)写成x−4，得到1/6；平方差系数2不能丢。','x邻近4且x≠4，共轭和非零。')
row(10,A,'derivative_definition',r'取f(x)=sin x，其导数cos x。x_n=2πn时导数1，z_n=(2n+1)π时导数−1，故导数在+∞的极限不存在。','给出可导反例并用两条无穷数列否定导数极限','选f(x)=x作为反例；导数恒1，其极限存在。','仅以cos x有界推出导数极限存在；两列1与−1已经否定收敛。','题面没有要求原函数极限存在；例子在实轴可导。',verdict='corrected')
row(12,Z,'important_limit',r'在x=0的可微函数g(x)=(1+x)^α，其导数g′(0)=α，所求正是导数定义。α=0时商恒0。','识别平移幂函数在0的导数','因(1+x)^α→1就认定商为0；仍是0/0。','令t=(1+x)^α−1并在α=0时除α；此时t恒0，除法无效。','α为实常数，x邻近0且1+x>0。')
row(16,N,'squeeze_theorem',r'令M=e^{|x|}≥1，则M^n≤1+e^{nx}+e^{−nx}≤3M^n；取n次根并夹逼，极限M=e^{|x|}，x=0同样成立。','用三项中的最大项作统一上下界','对x<0仍以e^{nx}作最大项，写总和≤3e^{nx}；e^(−nx)反而发散。','逐项取n次根后相加得到1+e^x+e^(−x)；根式不对加法分配。','n为正整数，x是固定实数。',verdict='corrected')
row(18,'S.limit.zero_times_inf','equiv_infinitesimal',r'sin(1/x)~1/x，商变成(x²+2)/[x(3x−1)]→1/3。','先替换乘积中的正弦小量再比较次数','只因sin(1/x)→0就把整乘积判0；另一个因子无界。','将sin(1/x)误换成x，次数不匹配且发散；小角是1/x。','x→∞，乘积中的sin(1/x)/(1/x)→1。')
row(20,N,'squeeze_theorem',r'c^n≤a^n+b^n+c^n≤3c^n，所以c≤(a^n+b^n+c^n)^(1/n)≤c 3^(1/n)→c。','围绕最大底数c夹逼','把n次根对和分配成a+b+c；根式不线性。','按三项平均值(a+b+c)/3确定极限；指数增长由最大项控制。','0≤a<b<c，故c>0，n为正整数。')
row(21,I,'divide_highest_power',r'有理因子同除x^5为O(x^(−2))；|2+cos x−sin x|≤4，故乘积趋0。','先确定有理因子衰减，再用振荡因子有界','分别求cos x与sin x的无穷极限再相乘；它们没有极限。','只保留x³和3x⁵后把次数约成x/x；应剩1/(3x²)。','|x|足够大分母非零，有界函数乘无穷小趋0。')
row(23,N,'squeeze_theorem',r'逐项有k/(n²+n)≤k/(n²+k)≤k/(n²+1)。求和后下界=1/2，上界=n(n+1)/[2(n²+1)]→1/2，故极限1/2。','统一分母上下界，利用等差求和夹逼','把n²+k写成n²+k²后得(ln2)/2；该式改变原题。','因为单项趋0就认定总和0；项数n也增长，不能有限求和换极限。','1≤k≤n，分母均为正。')
row(24,D,'one_sided_limit',r'先固定x令n→∞：|x|<1时f=x；|x|=1时f=0；|x|>1时f=−x。−1处左右限1、−1；1处左右限1、−1；因此仅±1为跳跃间断点，其他点连续。','先求点态极限分段函数，再判左右极限','认为每个有限n的函数连续所以极限函数也连续；点态收敛不能保证连续。','在|x|=1仍用|x|<1分支f=x；此时x^(2n)=1，实际函数值0。','先固定x再令n→∞，不交换这两个极限。',verdict='corrected')
duplicate(25,24,D,'与24完全相同的点态极限函数及连续性任务；已核对±1左右限，原25右限下标误写−1。')
row(27,C,'one_sided_limit',r'x→0−时指数项→0，分式→1，反正切→−π/2；x→0+时分式同除e^(1/x)趋−1，反正切→π/2。两边乘积都趋−π/2。','分别算两侧乘积，不分拆不存在的两侧极限','仅由arctan(1/x)两侧异号断言乘积无极限；另一因子也变号，乘积相同。','右侧把指数商判+1，得到+π/2；(1−E)/(1+E)在E→∞时趋−1。','x≠0，右侧同除正数e^(1/x)。')
duplicate(28,23,N,'与23是相同求和式。核对统一分母夹逼得1/2；原解答擅改n²+k为n²+k²而得ln2/2，需纠错。')
row(29,A,'derivative_definition',r'令h=−2x，分子=−[f(x0+h)−f(x0)]，除x=h/(−2)，故商→2f′(x0)=6。','换元同时保留分子反序与分母系数','只看h=−2x就得−6；分子反序还带一个负号。','把f(x0)−f(x0−2x)视为f(x0)−f(x0−x)得到3；步长实际是2x。','f在x0可导，h→0。')
row(30,N,'log_transform',r'由sin t=2sin(t/2)cos(t/2)反复使用，P_n=sin1/[2^n sin(2^(−n))]。分母=(sin(2^(−n))/2^(−n))→1，所以极限sin1。','用二倍角把有限乘积望远镜化为一个正弦比','逐因子cos(2^(−k))接近1就认定无限乘积1；有限恒等式已给sin1≠1。','把二倍角系数漏掉，写P_n=sin1/sin(2^(−n))而判发散；必须有2^n。','每个角在(0,1)内，正弦非零，n正整数。',verdict='missing_solved')
row(31,N,'squeeze_theorem',r'设S_n=Σ sin(1/k)。因1/k∈(0,1]，有sin1≤S_n≤n，开n次根后下上界都趋1，故极限1。','用固定正下界和项数上界夹逼','断言S_n≥1对所有n成立；n=1时sin1<1。','利用每项sin(1/k)→0就断言n次根趋0；总和至少sin1>0。','n正整数，各项为正且≤1。',verdict='corrected')
row(32,O,'equiv_infinitesimal',r'(1−cos x)ln(1+x²)~x⁴/2，x sin(x^n)~x^(n+1)，e^(x²)−1~x²。高阶要求4>n+1>2，所以n=2。','把高阶关系转化为幂次严格大小','按原解答倒写高阶小量比值并声称x^(n−3)→0要求n<3；实际此比值需n>3。','把高阶理解为次数更小而选n=4；n=4时中项x⁵比x⁴更高阶，次序颠倒。','n正整数；sin x^n按sin(x^n)读。',verdict='corrected')
row(33,Z,'lhopital',r'分子分母在π/4都为0。导数分别(1/3)(tan x)^(−2/3)sec²x与4sin x cos x，代π/4得(2/3)/2=1/3。','核对0/0后一次洛必达','把(tan x)^(1/3)−1改成(1+tan t)^(1/3)−(1−tan t)^(1/3)，漏除(1−tan t)^(1/3)；不是恒等式。','认为tan在π/4的导数为1，得到1/6；实际sec²(π/4)=2。','π/4邻域tan>0，分母导数非零。',verdict='corrected')
row(34,C,'one_sided_limit',r'令E=e^(1/x)>0，(1+E)/(1−E²)=1/(1−E)。左侧E→0,u=0，总和→1；右侧E→∞,u=1，总和也→1。','先约平方差再比较左右极限','忽略u(x)跳跃，因指数商左右不同就判不存在；加u后两侧都为1。','把E→∞的商1/(1−E)极限写成−1；它趋0。','x≠0且E≠1，恒等约分合法。')
row(37,I,'divide_highest_power',r'同除x^10，得到[(2+1/x)^4(1−1/x)^6−5(x+8)/x^9]/(1+2/x)^10→16。','分别保留每个幂因子的最高次系数','把(2x+1)^4最高次系数当2，得到2；应为2⁴。','把−5x(x+8)也当十次项加入系数，得到11；它只有二次。','|x|→∞且分母非零。')
row(39,Z,'factor_cancel',r'令u=(1+x)^(1/n)，则u^n−1=x，u−1=x/(u^(n−1)+…+1)。和趋n，故(u−1)/(x/n)→1。','使用n次幂差恒等式保留n个趋1的项','只保留幂差分解中的一个因子，称u−1=x；n>1时不成立。','把n个趋1的项相乘得1，忽略原式是求和；分母应趋n。','n为固定正整数，x邻0、1+x>0。')
row(40,'S.series.summation_function','series_summation',r'有限恒等式1/(1+t²)=Σ_{k=0}^N(−1)^k t^(2k)+(−1)^(N+1)t^(2N+2)/(1+t²)。在[0,1]积分，余项绝对值≤1/(2N+3)→0；左边arctan1=π/4，故给定和式=π/4。','有限几何级数积分并显式控制余项','在t=1把几何级数1−1+1−…当收敛级数逐项积分；端点几何级数不收敛。','由交错级数收敛定理直接声称和等于π/4；该定理只保证收敛与误差，不能确定此数值。','有限级数积分总合法；余项上界确保极限交换。',verdict='missing_solved')
row(41,'S.mvt.equation_root','zero_point_theorem',r'令h=(b−a)/2，g(x)=f(x)−f(x+h)，x∈[a,(a+b)/2]。g连续，g(a)=−g((a+b)/2)。端点为0即取端点，否则异号由零点定理得ξ。ξ落在该半区间，两个自变量都在[a,b]。','构造平移差并在半区间检查端点符号','在整个[a,b]上定义g并用零点定理；x接近b时x+h超出f的给定定义域。','用罗尔定理断言g′=0；原题只保证连续，而且g′=0也不是所求g=0。','a<b，半区间使两个函数值都有定义。')
row(43,R,'monotone_bounded',r'由算术几何平均x1≥√a，且xn>0。对n≥1，xn≥√a，所以x(n+1)−xn=(a−xn²)/(2xn)≤0。尾数列单调有下界故收敛于L≥√a；递推取极限L=(L+a/L)/2得L=√a。','先建立从第一项起的下界，再对尾数列证明单调','不检查x0就断言全序列递减；a=4,x0=1时x1=2.5>x0。','由递推方程得L=±√a并保留负根；所有项为正且尾项≥√a。','a>0,x0>0；单调只需从n=1起。',verdict='corrected')
row(45,E,'chain_rule',r'对f(−x)=−f(x)求导得−f′(−x)=−f′(x)，故奇函数的导数偶。对f(−x)=f(x)求导得−f′(−x)=f′(x)，故偶函数的导数奇。在0处，仅假定偶且f′(0)存在，差商左右对应互为相反数，所以共同极限只能0。','对奇偶恒等式求导，明确内层−x的系数','对f(−x)求导写成f′(−x)，漏−1，错误互换导数奇偶性。','偶函数在0都可导且导数0；反例|x|在0不可导，原题需存在前提。','奇偶函数定义域关于0对称；第三项仅使用0处可导。')
row(47,E,'derivative_definition',r'[sin(x+h)−sin x]/h=[sin(h/2)/(h/2)]cos(x+h/2)→cos x。','用和差化积把差商化成重要极限','把sin(x+h)当成sin x+sin h，得到导数1；正弦不对加法分配。','把sin的导数写成−cos x；差商给正cos x，负号属于cos导数。','h→0，重要极限使用弧度制。')
row(48,E,'derivative_definition',r'常数函数的差商[C−C]/h=0，故导数0。','直接检查常数函数的差商','把常数C视为变量x，求导写成1；C按题面固定。','把C的导数仍写成C；变化量始终0，与C取值无关。','C固定，h≠0后令h→0。')
row(49,H,'chain_rule',r'n为正整数，在实数幂可微区间反复求导，y^(n)=μ(μ−1)…(μ−n+1)(x+c)^(μ−n)。一般实μ可在x+c>0使用；非负整数μ时为多项式，n>μ导数恒0，勿将0乘未定义负幂当作端点公式。','归纳下降系数并核对实数幂的定义域','每阶只乘μ，写成μ^n(x+c)^(μ−n)；第二阶系数应μ(μ−1)。','求n阶导后幂次仍μ−1；每阶都使幂次再减1。','n≥1；一般实μ在x+c>0，多项式另作全实轴解释。',verdict='corrected')
row(52,H,'chain_rule',r'逐阶求导：y′=2ax+b，y″=2a，y‴=0。','逐阶消去多项式的幂次','常数项c求导为1，使一阶多出1；常数导数0。','二阶后把2a求导成2，认为三阶为2；a是常数。','a,b,c为常数。')
row(55,E,'derivative_definition',r'对一般实μ，在x>0取h→0，差商=x^(μ−1)[(1+h/x)^μ−1]/(h/x)→μx^(μ−1)。其他实数可微点按该实幂的定义域判断；μ非负整数时公式可作多项式解释。','在实数幂有定义的邻域使用幂函数重要极限','不分μ类型把公式用于所有负x；如μ=1/2时实平方根在负轴未定义。','差商缩放时漏外因子x^(μ−1)，声称导数恒μ。','一般实μ先在x>0论证；额外定义域需逐类判断。',verdict='corrected')
row(57,E,'derivative_definition',r'[a^(x+h)−a^x]/h=a^x(a^h−1)/h→a^x ln a。','提出a^x再使用指数重要极限','按幂函数公式给出xa^(x−1)；底数a固定、指数x变化。','写成a^x而漏ln a；a=e²时导数应2a^x。','a>0,a≠1；指数函数实轴有定义。')
row(58,E,'chain_rule',r'y=arccos x取值(0,π)，x=cos y。dx/dy=−sin y≠0，故dy/dx=−1/sin y=−1/√(1−x²)。','检查反余弦值域后求反函数导数','按原答案称arccos值域为(−π/2,π/2)；x<0时其值大于π/2。','把sin y取负平方根得正导数；y∈(0,π)时sin y>0。','x∈(−1,1)，y∈(0,π)。',verdict='corrected')
row(59,H,'leibniz_formula',r'由(1+x²)y′=1，对n−1阶求导得(1+x²)y^(n)+2(n−1)x y^(n−1)+(n−1)(n−2)y^(n−2)=0。代0递推，y′(0)=1,y″(0)=0；故n=2k时为0，n=2k+1时为(−1)^k(2k)!。','利用二次多项式高阶导数为零建立递推','将奇数阶值写成(−1)^k(2k+1)!；泰勒系数还含1/(2k+1)，阶乘应(2k)!。','因arctan为奇函数就说所有阶导数在0均0；只有偶数阶在0为0，一阶为1。','n>1整数；函数在0光滑。')
row(60,E,'derivative_definition',r'令u=h/x，差商=(1/x)[log_a(1+u)/u]→1/(x ln a)。','换底与步长缩放分别保留因子','把换底写成乘ln a，得到ln a/x；换底应除ln a。','直接给1/x而忽略底数；只有a=e时这一式子成立。','x>0,a>0,a≠1。')
row(61,H,'chain_rule',r'每阶求导乘常数λ而指数不变，所以y^(n)=λ^n e^(λx)，n≥1。λ=0时导数0。','跟踪线性内层系数λ并归纳','把e^(λx)拆写成e^λ x；两函数不同，原答案排版必须修复。','每阶系数只保留λ；第二阶即应λ²。','λ常数，n正整数。',verdict='corrected')
row(62,L,'linear_approximation',r'dy=3x²dx，在x=2、dx=0.02时dy=0.24。实际增量Δy=(2.02)³−8=0.242408，与微分不同。','明确微分是导数乘自变量增量','把实际增量0.242408当作所求微分；题目问dy=0.24。','用3x dx得到0.12；x³的导数是3x²而非3x。','x0=2，dx=Δx=0.02。')
row(69,E,'chain_rule',r'从落点开始的波纹r(0)=0、dr/dt=6，故t=2时r=12。A=πr²，所以dA/dt=2πr·6=144π m²/s。','先求该时刻半径，再对面积关系作链式求导','以半径速率6代替半径r得到72π；在2秒末r=12。','将dA/dt写成π(dr/dt)²=36π；面积的导数需要2r乘r′。','题目从落点产生波纹，初始半径0；t以秒计。')
row(72,T,'tangent_normal_equation',r'非退化双曲线a≠0，点(x0,y0)满足x0y0=a²且x0,y0≠0。隐导y′=−y0/x0，切线为y0 x+x0 y=2a²，与轴交于2x0、2y0。几何面积=|2x0·2y0|/2=2a²。a=0是两坐标轴，不构成这里的双曲线三角形。','求轴截距后用绝对值计算几何面积','按原答案把a=0也当双曲线三角形；退化坐标轴不围成非退化三角形。','只用切点x0,y0算面积a²/2；截距是两倍切点坐标。','“双曲线”意味着a≠0；两分支均需面积取绝对值。',verdict='corrected')
row(73,E,'chain_rule',r'题面“t=12cm”单位表明长的记号误植，规范为l=12cm并记录此修复。令d²=l²+w²，d′=(l l′+w w′)/√(l²+w²)。l=12,w=5时d=13，d′=(24+15)/13=3cm/s。','从勾股关系求导，保留两边同时变化','把对角线速率写成√(2²+3²)=√13；长度变化率不服从这种静态勾股组合。','只计算长的贡献24/13而忽略宽变化15/13。','把t=12cm正规化为l=12cm：题面长用l且cm是长度单位；l′=2,w′=3。',verdict='corrected',question=r'长方形长l以2cm/s增加，宽w以3cm/s增加。当l=12cm、w=5cm时，对角线增加的速率是多少？（原题t=12cm的长度记号已正规化为l）')
row(74,E,'chain_rule',r'设h为高度、θ为从地面观察员的仰角，tan θ=h/500。时间求导sec²θ θ′=h′/500。h=500时tan θ=1、sec²θ=2，所以θ′=140/(500·2)=0.14rad/min。图只说明直角关系，文字已提供水平距离与高度。','先建立仰角与高度关系，求导后代入该时刻数值','先把h=500代入得θ=π/4再求导为0；这是单时刻的值，不是恒定仰角。','忽略sec²θ，算成140/500=0.28；此时sec²θ=2。','观察点按原模型为地面点，水平距离固定500m，角以弧度计。')
duplicate(83,74,E,'与74同一气球文字题；图片只呈现已有直角关系，无新增必要条件。原高度、距离、速率与仰角结果完全相同。')
row(76,A,'derivative_definition',r'插入f(x0)，第一商为−2[f(x0−2h)−f(x0)]/(−2h)，第二商为−[f(x0+h)−f(x0)]/h，极限为−3f′(x0)。','插入同一基点函数值，分别恢复两个差商','只认出第一步长−2h而忽略第二项，得−2f′(x0)。','把第二项误作正f′(x0)，得到−f′(x0)；原分子含减号。','f在x0可导，h→0。')
row(78,F,'implicit_differentiation',r'正数取对数：ln y/x=ln x/y，即y ln y=x ln x。在可作光滑y(x)的分支且1+ln y≠0时，(1+ln y)y′=1+ln x，进一步(1+ln y)y″+(y′)²/y=1/x，得y″=1/[x(1+ln y)]−(1+ln x)²/[y(1+ln y)³]。y=e^(−1)时本式不能除；其中(x,y)=(e^(−1),e^(−1))对角分支y=x的y″=0，其他分支需另判。','取对数恢复乘积隐式关系并明确除数非零条件','将1+ln y=0的点也代入通式；这是除零，不能覆盖奇异点。','二次求导忽略[(ln y)′y′]=(y′)²/y，得到只有1/[x(1+ln y)]的一项。','x,y>0；一般公式只在1+ln y≠0的可微分支使用。',verdict='corrected')
row(79,L,'linear_approximation',r'A′(D)=πD/2，微分估计|ΔA|≈(π·60.03/2)·0.05=1.50075π≈4.71475mm²，相对误差≈2·0.05/60.03≈0.1666%。若要严格误差限，可由平方恒等式再加π(0.05)²/4，最大为约4.71671mm²。','区分微分近似与严格上界，核对数值与单位','将微分4.71475说成严格绝对误差限；正增量还带π(0.05)²/4。','把相对误差写成δD/D≈0.0833%；面积是直径平方，应乘2。','D>0，δD=0.05mm；微分估计为一阶近似。',verdict='corrected')
row(81,A,'derivative_definition',r'插入f(x0)，原商为3[f(x0+3h)−f(x0)]/(3h)+[f(x0−h)−f(x0)]/(−h)，故极限4f′(x0)。','分别处理正向三倍步长与负向一步长','只对分子两项之差机械减成(3−1)f′=2f′；负向步长和分子减号相消。','把两个点间距离认为2h，得2f′；实际是4h。','h=Δx→0，f在x0可导。')
row(82,'S.deriv.piecewise_differentiability','derivative_definition',r'命题为假。取f(x)=|x−x0|，则f(x0+h)−f(x0−h)=0，所以对称商极限0，但普通差商|h|/h左右为−1、1，f′(x0)不存在。原答案给不连续的反例也有效，但结尾“导数存在”应改“导数不存在”。','用对称差商与普通差商的具体反例区分可导性','把对称差商极限除2直接称为f′；|x−x0|已证明这不能推出导数存在。','把左右普通差商平均为0当作共同极限；左右不同则普通导数不存在。','h从正负两侧趋0；对称分子可能掩盖尖点。',verdict='corrected',question=r'判断：若lim_{h→0}[f(x0+h)−f(x0−h)]/h存在，则f′(x0)存在。请证明或给反例。（已移除原题泄漏的×标签）')
row(85,U,'monotonicity_analysis',r'f′=e^x−1，x<0时负、x>0时正。所以(−∞,0]递减，[0,+∞)递增。','导数零点划分区间后分别检查符号','因为e^x总正就说f单增；导数是e^x−1，负半轴小于0。','只因f′(0)=0就断言函数处处常数；只是单个驻点。','函数全实轴可导，0是唯一驻点。')
row(86,U,'monotonicity_analysis',r'f(x)=|x|^(2/3)，x≠0时f′=2/(3∛x)，负轴负、正轴正；0连续但不可导。因此(−∞,0]递减，[0,+∞)递增。','把不可导点也作分割点，用导数符号与连续性衔接','按原答案开头声称全实轴可导；0处差商符号发散，不能求导。','只解f′=0而说没有分割点；0是不可导点，单调方向在那里改变。','x=0不可导，在两侧分别应用单调性判别。',verdict='corrected')
row(87,B,'monotonicity_analysis',r'绝对值在1、2处分段，驻点3/2与不可导点1、2以及端点−3、4都需比较。函数值依次1,2处0；3/2处1/4；−3处20；4处6。故最大20在−3，最小0在1、2。','同时比较端点、驻点与不可导点','只比较驻点3/2，宣布最小1/4；不可导点1、2的函数值0更小。','把最大值只取右端点4的6；左端点−3的20更大。','闭区间连续，绝对值零点可不可导。')
row(88,'S.series.power_series_expansion','taylor_expansion',r'e^(2x)=Σ_{k=0}^n 2^k x^k/k!+o(x^n)，x→0，n正整数。由e^u的展开代u=2x，o((2x)^n)=o(x^n)；也可直接算f^(k)(0)=2^k。','替换变量后检查余项仍为o(x^n)','按原答案末行写e^x等于系数2^k的级数；左侧必须仍e^(2x)。','把(2x)^k写成2x^k而不是2^k x^k；二阶系数已错误。','n固定正整数，x→0。',verdict='corrected')
row(89,U,'monotonicity_analysis',r'x≠−1时f′=5(x−1)/(3∛(x+1))。在(−∞,−1)、(−1,1)、(1,+∞)导数符号依次+、−、+。因此−1为极大值点，值0；1为极小值点，值−3∛4。−1处不可导而函数连续。','把不可导点与驻点一起作符号分区','只检查f′=0所得x=1而漏x=−1；不可导点也能是极大值点。','把∛(x+1)在x<−1当正数，错误认定左区间递减。','实立方根在负数有定义，−1处须独立检查。')
row(90,U,'construct_auxiliary_function',r'f′在[0,1]连续故有界。取M≥max_{[0,1]}|f′|，令g(x)=f(x)+Mx，h(x)=Mx。两者导数g′=f′+M≥0,h′=M≥0，所以均单调不减且f=g−h。','给导数加一个足够大的常数构造两个不减函数','任取M=1就保证f+Mx单增；f(x)=−2x时导数仍−1。','把正负函数值部分max(f,0)、max(−f,0)称为单调函数；f振荡时这两部分也不单调。','闭区间连续可微意味着f′有界；M取非负上界。',verdict='missing_solved')
row(91,Q,'concavity_test',r'f″=12x(3x−2)。在(−∞,0)、(2/3,+∞)二阶导数正，曲线向上弯；在(0,2/3)二阶导数负，向下弯。两处符号改变，拐点为(0,1)、(2/3,11/27)。','按二阶导数符号判断弯曲方向并代入拐点坐标','只列f″=0而不检查变号就判拐点；本题需展示两处变号。','把x=2/3处函数值算成0；代入3(2/3)^4−4(2/3)^3+1=11/27。','f为多项式，二阶导连续；用向上/向下弯避免凹凸术语歧义。',verdict='missing_solved')
row(92,B,'monotonicity_analysis',r'f′=2(x³+27)/x²，在x<−3时负、−3<x<0时正，因此全域在x=−3取得唯一最小值f(−3)=27。两端x→−∞和x→0−时都趋+∞。','用整个负半轴的导数符号证明全局最小','只算f″(−3)>0就直接称全局最小；二阶判别本身仅给局部结论，仍需全域比较。','把定义域忽略而取x=3；题面只允许x<0。','定义域x<0，分母x²正。')
row(93,B,'construct_auxiliary_function',r'令圆周长x，正方形周长a−x，0≤x≤a，面积S=x²/(4π)+(a−x)²/16。配方得S=(π+4)/(16π)[x−aπ/(π+4)]²+a²/[4(π+4)]，所以圆段aπ/(π+4)、方段4a/(π+4)，最小面积a²/[4(π+4)]。','建立总面积并配方确定唯一最小分配','把两段均分a/2认定最优；面积函数系数不同，驻点不是a/2。','把圆面积写成x²/π；x是周长，应除4π。','铁丝总长a>0，x是圆周长而非半径。')
row(94,U,'monotonicity_analysis',r'实数定义域x≠1，x=0不可导。x≠0,1时f′=−4(x+2)/[3∛x(x−1)²]。符号在(−∞,−2)、(−2,0)、(0,1)、(1,+∞)依次−、+、−、−，所以递减区间(−∞,−2]、[0,1)、(1,+∞)，递增[−2,0]。1未定义不能跨越。','分割驻点、不可导点和定义域断点后看导数符号','把0和1都称定义域内不可导点；1根本不在定义域。','把(0,1)与(1,+∞)合并成(0,+∞)单调区间；1处断裂且跨两侧数值不满足单调。','x^(2/3)按实立方根平方解释；0连续不可导、1除零。',verdict='corrected')
row(95,O,'taylor_expansion',r'f=x−a sin x−(b/2)sin2x=(1−a−b)x+(a+4b)x³/6−(a+16b)x⁵/120+o(x⁵)。五阶要求前两系数0且五阶非零，得a=4/3,b=−1/3，五阶系数1/30。原答案交换了a,b，甚至一次项条件不符合。','按相消阶数列参数方程，再检查五阶系数非零','照原答案取a=−1/3,b=4/3；三阶系数a+4b=5不为0。','只满足a+b=1就断言五阶；还必须a+4b=0且五阶系数非零。','x→0；“五阶”是f/x⁵趋非零常数。',verdict='corrected')
row(96,Z,'taylor_expansion',r'cos x=1−x²/2+x⁴/24+o(x⁴)，e^(−x²/2)=1−x²/2+x⁴/8+o(x⁴)。分子=−x⁴/12+o(x⁴)，sin⁴x~x⁴，故极限−1/12。','保留到四阶，单独核对相减符号','采用原答案1/6；四阶系数实际1/24−1/8=−1/12。','两项都用一阶等价1直接相减得0；常数和二阶消失后四阶主项决定极限。','x→0，sin x/x→1。',verdict='corrected')
row(97,H,'leibniz_formula',r'多项式1+x²三阶导起为0，莱布尼茨只留k=0,1,2。在0处一阶多项式导数为0，故f^(100)(0)=1+C(100,2)·2=9901。','利用多项式截断与0点代值减少高阶求导','把组合数C(100,2)漏掉，得1+2=3；混合导数必须计组合次数。','由f(0)=1断言所有高阶导在0都是1；x²与e^x的混合贡献9900。','所有阶导存在，e^x各阶在0为1。')
row(98,K,'construct_auxiliary_function',r'构造F(x)=ax⁴+bx³+cx²−(a+b+c)x，F(0)=F(1)=0，多项式满足闭区间连续、开区间可导。罗尔定理得ξ∈(0,1)使F′(ξ)=0，即原方程。原解答末行应F′而非f′。','构造端点等值的原函数，罗尔给出所求根','直接对原三次式用罗尔而未验证端点等值；它的端点通常不同。','把罗尔结论写成三次式自身导数为0；所求是三次式为0，应对构造的四次F求导。','a,b,c任意实常数，多项式全轴可导。',verdict='corrected')
row(99,J,'lagrange_mvt',r'ln(1+t)在[0,x]连续且在(0,x)可导；中值定理给ln(1+x)=x/(1+ξ)，0<ξ<x。分母1<1+ξ<1+x且x>0，所以x/(1+x)<ln(1+x)<x。','用中值定理把对数写成一个可比较的分式','把ξ直接取x，得等式ln(1+x)=x/(1+x)；ξ严格在开区间。','比较倒数时保持大小方向不变，得对数小于x/(1+x)；正倒数会反向。','x>0，闭区间[0,x]满足定理假设。')
row(100,J,'construct_auxiliary_function',r'令F=sin x+tan x−2x，F(0)=F′(0)=0。F″=sin x(2/cos³x−1)>0在(0,π/2)成立，因此F′>0、F>0，得到不等式。','逐级检查二阶、一阶和原函数的正性','分别用sin x<x与tan x>x就断言它们之和>2x；两方向不同，不足比较总和。','把tan x导数写成sec x，错误判F′符号；应sec²x。','0<x<π/2，sin正且0<cos<1。')
row(101,'S.mvt.identity_proof','lagrange_mvt',r'G=arcsin x+arccos x，在(−1,1)有G′=0。任意内点之间中值定理给G相同，由G(0)=π/2确定常数；端点由连续性补得同一值。','内区间用导数零证明常数，端点用连续性','在±1直接套有限导数公式；分母√(1−x²)=0，导数公式不适用。','仅验x=0的值就推出恒等式；还须证明G在全区间不变。','反三角函数取主值，在闭区间连续、开区间可导。',verdict='corrected')
row(102,J,'construct_auxiliary_function',r'令g(t)=t^n，t>0、n>1，则g″=n(n−1)t^(n−2)>0，严格凸。中点m=(x+y)/2；x≠y时可设x<m<y，用拉格朗日中值定理得两割线斜率g′(ξ1)<g′(ξ2)，由于两边距离相同，推出g(x)+g(y)>2g(m)。','用严格增的导数比较中点两侧割线斜率','忽略x≠y仍称严格大于；x=y时只能等号。','将n>1删去而取n=1仍称严格不等式；线性函数两边相等。','x,y>0,x≠y,n>1；用严格凸的标准命名。',verdict='corrected')
row(103,K,'construct_auxiliary_function',r'令G(x)=xf(x)，在[0,a]连续、(0,a)可导，G(0)=0=G(a)。罗尔给ξ∈(0,a)使G′=f(ξ)+ξf′(ξ)=0，即所求。','以乘积xf构造端点等值函数','直接对f用罗尔；已知f(a)=0但未给f(0)=0，端点未必等值。','构造f/x并在0使用罗尔；该商在0可能未定义不连续。','区间[0,a]且存在内点意味着a>0；xf在0仍连续。')
row(104,J,'construct_auxiliary_function',r'G(x)=x^p/p+1/q−x，G′=x^(p−1)−1。p>1时在0<x<1负、x>1正，故唯一全局最小在1；G(1)=1/p+1/q−1=0，得到不等式，等号仅x=1。','用导数全域符号证明最小值为0','仅因二阶导数在1正就断言全局最小；需全域单调或凸性论证。','忽略1/p+1/q=1而仍称G(1)=0；该参数条件正是零最小值来源。','x>0,p,q>1且互为共轭指数。')
row(105,U,'monotonicity_analysis',r'f在实轴二阶可导，极值点a≠1由费马得f′(a)=0。代入原关系f″(a)=(1−e^(1−a))/(a−1)。分子与a−1同号，所以f″(a)>0；二阶充分条件说明此处为严格极小值。','先用极值的必要条件再检查二阶导数符号','把分子1−e^(1−a)对所有a都判正；a<1时实际负，须与分母共同比较。','在a=1也同除a−1来套公式；题目明确排除1，那里无法如此除。','a≠1且是可导内点极值，f″(a)存在。')
row(106,Y,'cauchy_mvt',r'取g(x)=ln x。f,g在[a,b]连续、内区间可导，g′=1/x非零。柯西中值定理有[f(b)−f(a)]/[ln b−ln a]=f′(ξ)/(1/ξ)=ξf′(ξ)，即结论。','选择对数配合柯西中值定理','分别对f和ln使用拉格朗日后把两个中值点当同一个ξ；两次存在结论不能保证同点。','在柯西比值中把g′(ξ)=1/ξ写成ξ，得到f′/ξ；导数倒置。','0<a<b保证ln定义、端点差非零、g′非零。')
row(107,Q,'concavity_test',r'令g=f′，原式g′=sin x−g²且g(0)=0。因f二阶可导，g连续，右侧连续，所以g′连续；进而右侧可导，g″=cos x−2gg′，g′(0)=0、g″(0)=1。于是g′(x)=x+o(x)，在充分小的负侧负、正侧正。f″=g′在0两侧变号，故(0,f(0))是拐点。','由原方程补出足够正则性，再核对二阶导数两侧变号','只由f″(0)=0就称拐点；如x⁴二阶在0为0却两側不变号。','把(f′)²≥0当作f″与sin x处处同号；相减可改号，必须用g″(0)=1的一阶局部展开。','方程在0的邻域成立、f二阶可导；由方程推出g″存在而非额外假定。',verdict='missing_solved')

# Existing first-batch identities and all route contents are retained exactly.
v={'op':'var'};c={'op':'const'}
def op(name,*args):return {'op':name,'args':list(args)}
def pw(x):return op('power',x,c)
def d(x):return op('derivative',x)
def lm(x):return op('limit',x)
trees={
1:op('continuity',op('cos',op('divide',c,v))),
3:op('continuity',op('divide',c,v)),
6:lm(op('divide',op('subtract',op('power',c,v),c),v)),
7:lm(op('divide',op('log',op('add',c,v)),v)),
9:lm(op('divide',op('subtract',op('sqrt',op('add',c,op('multiply',c,v))),c),op('subtract',v,c))),
10:op('counterexample',lm(d(op('sin',v)))),
12:lm(op('divide',op('subtract',pw(op('add',c,v)),c),v)),
16:lm(op('root',op('add',c,op('exp',op('multiply',v,v)),op('exp',op('negate',op('multiply',v,v)))),v)),
18:lm(op('multiply',op('divide',op('add',pw(v),c),op('subtract',op('multiply',c,v),c)),op('sin',op('divide',c,v)))),
20:lm(op('root',op('add',pw(c),pw(c),pw(c)),v)),
21:lm(op('divide',op('multiply',op('add',pw(v),op('multiply',c,v),c),op('subtract',op('add',c,op('cos',v)),op('sin',v))),op('add',pw(v),op('multiply',c,v),c))),
23:lm(op('summation',op('divide',v,op('add',pw(v),v)))),
24:op('continuity',lm(op('multiply',op('divide',op('subtract',c,op('power',v,op('multiply',c,v))),op('add',c,op('power',v,op('multiply',c,v)))),v))),
27:lm(op('multiply',op('divide',op('subtract',c,op('exp',op('divide',c,v))),op('add',c,op('exp',op('divide',c,v)))),op('arctan',op('divide',c,v)))),
29:lm(op('divide',op('subtract',op('function',v),op('function',op('subtract',v,op('multiply',c,v)))),v)),
30:lm(op('product',op('cos',op('divide',c,op('power',c,v))))),
31:lm(op('root',op('summation',op('sin',op('divide',c,v))),v)),
32:op('order_compare',op('multiply',op('subtract',c,op('cos',v)),op('log',op('add',c,pw(v)))),op('multiply',v,op('sin',pw(v))),op('subtract',op('exp',pw(v)),c)),
33:lm(op('divide',op('subtract',op('root',op('tan',v),c),c),op('subtract',op('multiply',c,pw(op('sin',v))),c))),
34:lm(op('add',op('divide',op('add',c,op('exp',op('divide',c,v))),op('subtract',c,op('exp',op('divide',c,v)))),op('piecewise',v,c))),
37:lm(op('divide',op('subtract',op('multiply',pw(op('add',op('multiply',c,v),c)),pw(op('subtract',v,c))),op('multiply',c,v,op('add',v,c))),pw(op('add',v,c)))),
39:op('equivalence',op('subtract',op('root',op('add',c,v),v),c),op('divide',v,v)),
40:op('summation',op('divide',op('power',op('negate',c),v),op('add',op('multiply',c,v),c))),
41:op('existence',op('subtract',op('function',v),op('function',op('add',v,op('divide',op('subtract',v,v),c))))),
43:lm(op('recurrence',op('divide',op('add',v,op('divide',c,v)),c))),
45:op('parity',d(op('function',op('negate',v)))),
47:d(op('sin',v)),48:d(c),49:op('derivative',pw(op('add',v,c)),v),
52:op('derivative',op('add',op('multiply',c,pw(v)),op('multiply',c,v),c),c),
55:d(pw(v)),57:d(op('power',c,v)),58:d(op('arccos',v)),
59:op('evaluate',op('derivative',op('arctan',v),v),c),60:d(op('log',v)),
61:op('derivative',op('exp',op('multiply',c,v)),v),
62:op('differential',pw(v)),
69:d(op('multiply',c,pw(op('function',v)))),
72:op('tangent_area',op('equal',op('multiply',v,v),pw(c))),
73:d(op('sqrt',op('add',pw(op('function',v)),pw(op('function',v))))),
74:d(op('arctan',op('divide',op('function',v),c))),
76:lm(op('divide',op('subtract',op('function',op('subtract',v,op('multiply',c,v))),op('function',op('add',v,v))),v)),
78:op('implicit_derivative',op('equal',op('multiply',v,op('log',v)),op('multiply',v,op('log',v))),c),
79:op('error_estimate',op('multiply',c,pw(v))),
81:lm(op('divide',op('subtract',op('function',op('add',v,op('multiply',c,v))),op('function',op('subtract',v,v))),v)),
82:op('counterexample',lm(op('divide',op('subtract',op('function',op('add',v,v)),op('function',op('subtract',v,v))),v)),d(op('function',v))),
85:op('monotonicity',op('subtract',op('exp',v),v,c)),
86:op('monotonicity',op('root',pw(v),c)),
87:op('extrema',op('absolute',op('add',pw(v),op('negate',op('multiply',c,v)),c)),op('interval',c,c)),
88:op('taylor',op('exp',op('multiply',c,v))),
89:op('extrema',op('multiply',op('subtract',v,c),op('root',pw(op('add',v,c)),c))),
90:op('decomposition',op('function',v),op('subtract',op('function',v),op('function',v))),
91:op('concavity',op('add',op('multiply',c,pw(v)),op('negate',op('multiply',c,pw(v))),c)),
92:op('extrema',op('subtract',pw(v),op('divide',c,v))),
93:op('optimization',op('add',op('divide',pw(v),c),op('divide',pw(op('subtract',c,v)),c))),
94:op('monotonicity',op('divide',op('multiply',c,op('root',pw(v),c)),op('subtract',v,c))),
95:op('order',op('subtract',v,op('multiply',op('add',c,op('multiply',c,op('cos',v))),op('sin',v)))),
96:lm(op('divide',op('subtract',op('cos',v),op('exp',op('negate',op('divide',pw(v),c)))),pw(op('sin',v)))),
97:op('evaluate',op('derivative',op('multiply',op('add',c,pw(v)),op('exp',v)),c),c),
98:op('root_proof',op('subtract',op('add',op('multiply',c,pw(v)),op('multiply',c,pw(v)),op('multiply',c,v)),op('add',c,c,c))),
99:op('inequality',op('divide',v,op('add',c,v)),op('log',op('add',c,v)),v),
100:op('inequality',op('add',op('sin',v),op('tan',v)),op('multiply',c,v)),
101:op('identity',op('add',op('arcsin',v),op('arccos',v)),c),
102:op('inequality',op('divide',op('add',pw(v),pw(v)),c),pw(op('divide',op('add',v,v),c))),
103:op('existence',op('equal',op('function',v),op('negate',op('multiply',v,d(op('function',v)))))),
104:op('inequality',op('add',op('divide',pw(v),v),op('divide',c,v)),v),
105:op('extrema',op('equal',op('add',op('multiply',op('subtract',v,c),op('derivative',op('function',v),c)),op('multiply',c,op('subtract',v,c),d(op('function',v)))),op('subtract',c,op('exp',op('subtract',c,v))))),
106:op('existence',op('equal',op('subtract',op('function',v),op('function',v)),op('multiply',v,d(op('function',v)),op('log',op('divide',v,v))))),
107:op('inflection',op('equal',op('add',op('derivative',op('function',v),c),pw(d(op('function',v)))),op('sin',v))),
}
for i,tree in trees.items():out[i]['question']['structure']=tree

def st(sid,mid,state,result,cond):
    return dict(scenarioId=sid,methodId='M.'+mid,state=state,transformedState=result,condition=cond)
def enrich(i,summary,steps,reason,criterion,mainsteps=None):
    q=out[i]['question']
    q['routes'].append(dict(id='r-alternative',summary=summary,steps=steps,valid=True,preferred=False,condition='；'.join(x['condition'] for x in steps),reason=reason))
    q['comparisonCriterion']=criterion
    if mainsteps:q['routes'][0]['steps']=mainsteps

enrich(6,'按指数函数在0的导数直接识别差商',[
    st(Z,'derivative_definition','(a^x−1)/x','这是g(x)=a^x在0的差商，g′(0)=ln a。','a>0；a=1时导数0。')],
    '导数定义路线成立，但若正在用该极限证明指数求导公式，不能循环引用它。','若未建立指数求导公式，优先改写为指数重要极限；已建立公式时两者均可。')
enrich(7,'换底后用一次洛必达',[
    st(Z,'lhopital','log_a(1+x)/x的0/0','求导之商为1/[(1+x)ln a]→1/ln a。','a>0,a≠1；x邻近0，分母导数1非零。')],
    '满足洛必达条件；换底重要极限少一次求导。','优先利用已经掌握的对数重要极限，减少求导。')
enrich(9,'用一次洛必达处理根式差商',[
    st(Z,'lhopital','分子、分母在x→4时均趋0','导数之商为1/√(1+2x)→1/3。','4附近根式可导，分母导数1非零。')],
    '可直接求导，但有理化只依靠恒等式即可消除未定式。','优先用恒等变形消除根式差，避免调用更强定理。')
enrich(12,'使用幂函数导数与一次洛必达',[
    st(Z,'lhopital','[(1+x)^α−1]/x','导数商α(1+x)^(α−1)→α。','α实常数，1+x>0，分母导数为1；α=0同样成立。')],
    '求导公式已经建立时合法；若正在证明幂函数求导，则应回到重要极限而不能循环引用。','按已学知识选择路线；避免用本题尚待证明的导数公式循环论证。')
enrich(16,'提出最大指数项后对余下n次根取对数',[
    st(N,'log_transform','令M=e^{|x|}，原根式=M·B_n^(1/n)','B_n=(1+e^{nx}+e^(−nx))/M^n，1≤B_n≤3。','x固定、n正整数，M>0。'),
    st(N,'log_transform','B_n^(1/n)','0≤ln B_n/n≤ln3/n→0，故B_n^(1/n)→1，原极限M。','B_n正，指数函数连续。')],
    '对数把变动底数的n次根转为可控小量，与直接根式夹逼同样成立。','优先直接围住原n次根；额外取对数不缩短本题的界估计。')
enrich(18,'先令t=1/x，把乘积整理为0/0，再用重要极限',[
    st('S.limit.zero_times_inf','equiv_infinitesimal','x→∞，t=1/x→0','原式=[(1+2t²)/(3−t)]·sin t/t。','x≠0；换元为恒等整理，暂不丢弃任一因子。'),
    st(Z,'important_limit','sin t/t与趋1/3的有理因子','sin t/t→1，有理因子→1/3，乘积→1/3。','t→0，3−t非零；sin t/t的两侧重要极限成立。')],
    '这条路线显式转入0/0，适合还不熟悉乘积中等价替换的学习者。','优先直接在乘积中替换sin(1/x)，减少换元与整理；两路都保留实际小角1/x。',[
    st('S.limit.zero_times_inf','equiv_infinitesimal','无界有理因子乘sin(1/x)','sin(1/x)~1/x，所以原乘积与(x²+2)/[x(3x−1)]同极限。','x→∞；替换仅发生于乘积中的正弦因子。'),
    st(I,'divide_highest_power','整理后的二次/二次有理商','同除x²得到(1+2/x²)/(3−1/x)→1/3。','|x|足够大，分母非零。')])
enrich(20,'提出c^n后取对数估计余下的n次根',[
    st(N,'log_transform','原式=c[1+(a/c)^n+(b/c)^n]^(1/n)','余下括号B_n在[1,3]内。','c>0且0≤a/c<b/c<1。'),
    st(N,'log_transform','ln B_n/n','0≤ln B_n/n≤ln3/n→0，故原极限c。','B_n≥1；取对数与指数连续。')],
    '正底数取对数合法，但没有比直接夹逼减少估计。','优先给原根式上下界，避免额外取对数。')
enrich(23,'用统一近似的误差上界与基准和比较',[
    st(N,'inequality_scaling','对比Σk/(n²+k)与Σk/n²','0≤Σk/n²−Σk/(n²+k)=Σk²/[n²(n²+k)]≤Σk²/n⁴。','1≤k≤n，所有分母正。'),
    st(N,'inequality_scaling','误差≤n(n+1)(2n+1)/(6n⁴)→0','基准和Σk/n²=(n+1)/(2n)→1/2，故原和趋1/2。','三项求和公式用于有限整数和。')],
    '直接误差控制也是合法路线；夹逼统一分母所需公式更少。','优先使用一阶求和与统一分母夹逼，减少平方求和和误差估计。')
# This problem has two genuinely different phases, not one continuity slogan.
out[24]['question']['routes'][0]['steps']=[
    st(D,'one_sided_limit','先固定x求n→∞的点态极限','|x|<1时f=x，|x|=1时f=0，|x|>1时f=−x。','x固定；x^(2n)按模小于、等于、大于1分情况。'),
    st(D,'one_sided_limit','得到的分段函数在±1附近','−1处左右限1、−1；1处左右限1、−1，均有限不相等，故跳跃。','先求出的函数再取x单侧极限，不交换x与n极限。'),
    st(C,'one_sided_limit','其余点所在的开区间','每个区间的表达式x或−x均连续，因此没有其他间断点。','避开±1，邻域落在同一分支。')]
enrich(27,'先用t=1/x统一两侧的无穷方向，再算乘积',[
    st(C,'one_sided_limit','x→0两侧令t=1/x','负侧t→−∞，正侧t→+∞；目标为[(1−e^t)/(1+e^t)]arctan t。','换元分别保持两侧方向，不能把两侧并成同一个无穷方向。'),
    st(C,'one_sided_limit','t→±∞的两个因子','负侧为1·(−π/2)，正侧为(−1)·π/2；两侧均−π/2。','正侧指数商同除e^t；负侧直接用e^t→0。')],
    '换元能把单侧极限变成熟悉的无穷极限，但和直接单侧计算相同。','优先直接分析x的两侧，减少新变量并防止方向混淆。')
enrich(29,'以可微展开直接处理带有两倍步长的函数值',[
    st(A,'equiv_infinitesimal','在x0处使用可微展开','f(x0−2x)=f(x0)−2x f′(x0)+o(x)。','f在x0可导；固定系数−2使o(−2x)=o(x)。'),
    st(A,'equiv_infinitesimal','代回分子并除x','商=2f′(x0)+o(1)→6。','x≠0，f′(x0)=3；不假定f在邻域可导。')],
    '可微展开只使用题给单点导数，不需要洛必达所需邻域导数。','优先直接恢复导数定义，减少余项记号；展开法可作为等价复核。')
enrich(33,'换元u=tan x，用立方差因式精确约分',[
    st(Z,'factor_cancel','u=tan x→1，分母=(u²−1)/(1+u²)','商=(u^(1/3)−1)(1+u²)/(u²−1)。','π/4附近tan有定义且正；所用三角式是恒等式。'),
    st(Z,'factor_cancel','u−1=(u^(1/3)−1)(u^(2/3)+u^(1/3)+1)','约分后得(1+u²)/[(u+1)(u^(2/3)+u^(1/3)+1)]→2/(2·3)=1/3。','u≠1可约分，保留趋近极限，剩余分母趋6非零。')],
    '恒等约分成立，但比一次洛必达多一次换元和两个因式分解。','已建立求导公式时优先一次洛必达，减少三角恒等变换和立方差约分。')
enrich(39,'由平移根函数在0的导数识别等价关系',[
    st(Z,'derivative_definition','[(1+x)^(1/n)−1]/x','g(x)=(1+x)^(1/n)，g′(0)=1/n，所以比值除以1/n趋1。','n固定正整数、1+x>0；幂函数求导公式已经建立。')],
    '导数识别简短；若本题用于建立根函数求导，须使用原路线的n次幂差证明。','尚未建立求导公式时优先幂差恒等式，避免循环证明。')
out[43]['question']['routes'][0]['steps']=[
    st(R,'inequality_scaling','正递推xn与a/xn的均值','x(n+1)≥√a，所以从x1起有正下界。','a>0,x0>0；递推保持正性。'),
    st(R,'monotone_bounded','n≥1时xn≥√a','x(n+1)−xn=(a−xn²)/(2xn)≤0，尾数列单调有下界，故有极限L≥√a。','只要求尾数列单调；x0可能小于√a。'),
    st(R,'monotone_bounded','对正有限极限取递推极限','L=(L+a/L)/2，L²=a且L>0，故L=√a。','L≥√a>0，因此除L和连续代入均合法。')]
enrich(47,'写成sin(x+h)的加法公式并分别处理两个标准极限',[
    st(E,'derivative_definition','[sin(x+h)−sin x]/h','差商=sin x·(cos h−1)/h+cos x·sin h/h。','x固定，正弦加法公式是恒等式。'),
    st(Z,'important_limit','两个关于h的标准商','(cos h−1)/h→0、sin h/h→1，因此导数cos x。','角用弧度；第一商可用1−cos h=2sin²(h/2)核对。')],
    '加法公式路线与和差化积都合法；前者需处理两个标准商。','优先用和差化积只保留一个重要极限。')
enrich(58,'对恒等式cos y=x隐式求导',[
    st(E,'chain_rule','令y=arccos x，先改写cos y=x','值域y∈(0,π)，所以sin y=√(1−x²)>0。','x∈(−1,1)，反函数可导与链式法则已建立。'),
    st(F,'implicit_differentiation','cos y=x','−sin y·y′=1，故y′=−1/√(1−x²)。','sin y>0，除法合法；仅在开区间求导。')],
    '显式展示隐式关系中的链式因子，与直接反函数导数公式等价。','优先先检查值域与sin y符号；反函数公式可少一次隐式整理。')
enrich(59,'用反正切的麦克劳林系数读取高阶导数',[
    st(H,'chain_rule','arctan x在0的高阶导数','先识别它在|x|<1的展开Σ_{k≥0}(−1)^k x^(2k+1)/(2k+1)。','已建立反正切幂级数；其可由1/(1+x²)几何级数积分得到。'),
    st('S.series.power_series_expansion','power_series_expansion','0点展开系数与阶导数的关系','偶次系数0；2k+1次系数(−1)^k/(2k+1)，乘(2k+1)!得(−1)^k(2k)!。','在收敛半径内使用泰勒系数关系，n>1整数。')],
    '已知级数时直接读系数很短；递推路线无需预先掌握整份反正切展开。','没有现成反正切级数时优先从二次乘积建立有限递推。')
enrich(73,'先显式表示对角线再按复合函数求导',[
    st(E,'chain_rule','d(t)=√(l(t)²+w(t)²)','d′=[2l l′+2w w′]/[2√(l²+w²)]。','l,w在该时刻可导，对角线正。'),
    st(E,'chain_rule','l=12,w=5,l′=2,w′=3','d′=(12·2+5·3)/13=3cm/s。','先求导后代值；原长度t=12cm已正规化为l=12cm。')],
    '显式平方根路线合法；先平方的隐式路线省去根式求导分母。','优先从d²=l²+w²求导，减少根式链式因子的整理。')
enrich(74,'先写出仰角的反正切表达式再链式求导',[
    st(E,'chain_rule','θ=arctan(h/500)','θ′=[1/(1+(h/500)²)]·h′/500。','水平距离500固定，θ为弧度且在(0,π/2)。'),
    st(E,'chain_rule','h=500,h′=140','θ′=(1/2)·140/500=0.14rad/min。','先对随时间变化的高度求导，再代入时刻值。')],
    '显式反正切路线可行；正切关系求导更直接对应图形中的比例。','优先由tan θ=h/500保留几何关系，减少反函数改写。')
enrich(76,'利用基点可微展开抵消共同的函数值',[
    st(A,'equiv_infinitesimal','f(x0−2h)与f(x0+h)的单点可微展开','分别为f(x0)−2h f′(x0)+o(h)与f(x0)+h f′(x0)+o(h)。','仅需x0处导数存在；不要求邻域导数。'),
    st(A,'equiv_infinitesimal','相减后除h','商=−3f′(x0)+o(1)，极限−3f′(x0)。','两份o(h)相减仍o(h)，h→0。')],
    '余项展开合法并让步长系数清楚，原路线恢复两个差商则不需额外记号。','优先恢复两个标准差商；已有可微展开知识时可作简短复核。')
enrich(90,'用导数正负部分的积分构造两个不减函数',[
    st(U,'construct_auxiliary_function','f′连续，令g=f(0)+∫₀ˣmax(f′(t),0)dt，h=∫₀ˣmax(−f′(t),0)dt','两被积函数连续非负，所以g′≥0,h′≥0，两函数单调不减。','连续可微保证正负部分连续，微积分基本定理适用。'),
    st(U,'construct_auxiliary_function','计算g−h','g−h=f(0)+∫₀ˣf′(t)dt=f(x)，得到所需分解。','max(u,0)−max(−u,0)=u；常数f(0)放入g不改变单调性。')],
    '积分分解也合法且反映导数变化，但原路线只需一个导数上界。','优先加线性函数的构造，避免额外积分与正负部分定义。')
enrich(93,'先求总面积的一阶导数，再由严格凸性确定全局最小',[
    st(B,'construct_auxiliary_function','令圆周长x，总面积S=x²/(4π)+(a−x)²/16','S′=x/(2π)+(x−a)/8，唯一零点x=aπ/(π+4)。','a>0,0≤x≤a，该零点严格在区间内。'),
    st(B,'monotonicity_analysis','S″=(π+4)/(8π)>0','S′在零点左负右正，唯一全局最小；正方形段为4a/(π+4)。','同一闭区间上S连续且严格凸，端点不会优于内部最低点。')],
    '求导路线合法并便于推广；本题是二次式，配方直接给最小值与分配。','优先配方同时读出最小面积与两段长度。')
enrich(96,'以t=x²改写分子，再对二阶小量使用展开',[
    st(Z,'taylor_expansion','分母sin⁴x~x⁴，令t=x²→0+','目标等于[cos√t−e^(−t/2)]/t²的右极限。','两侧x给同一非负t，分子为偶函数；sin⁴x/x⁴→1。'),
    st(Z,'taylor_expansion','cos√t与e^(−t/2)保留t²','展开分别1−t/2+t²/24+o(t²)与1−t/2+t²/8+o(t²)，相减得−1/12。','保留二次项才能看到常数与一次相消后留下的差。')],
    '换元后仍需相同的有效系数，只是把四阶展开写成t的二阶展开。','优先直接按x保留四阶，减少额外换元且保留相减符号。')
enrich(97,'从麦克劳林展开只读取x^100系数',[
    st(H,'chain_rule','求f^(100)(0)，先改看其泰勒系数','e^x展开中x^100项系数1/100!；乘x²后的贡献来自x^98，系数1/98!。','e^x在0可展开，有限目标系数只需要这两项。'),
    st('S.series.power_series_expansion','power_series_expansion','(1+x²)e^x的x^100系数','乘100!得到1+100·99=9901。','n阶导数在0等于n!乘n次项系数。')],
    '泰勒系数法也只处理两项；直接莱布尼茨利用多项式截断无需展开到指定阶。','优先利用多项式高阶导为零的莱布尼茨截断，少引入高阶展开。')
enrich(99,'构造上下界的两个差函数并检查正导数',[
    st(J,'construct_auxiliary_function','G=ln(1+x)−x/(1+x)，H=x−ln(1+x)','G(0)=H(0)=0，G′=x/(1+x)²>0,H′=x/(1+x)>0。','x>0，分母都正。'),
    st(J,'construct_auxiliary_function','两差函数在正半轴递增','G(x)>0且H(x)>0，即两个严格不等式。','从0到任意x>0导数严格正，连续延至0。')],
    '差函数路线合法，但需构造两个函数；中值定理一个分式同时给两界。','优先一次中值定理同时证明上下界。')
enrich(101,'利用反三角函数主值的互余关系直接证明',[
    st('S.mvt.identity_proof','construct_auxiliary_function','令θ=arcsin x∈[−π/2,π/2]','π/2−θ∈[0,π]且cos(π/2−θ)=sin θ=x。','x∈[−1,1]；检查角在arccos的主值区间。'),
    st('S.mvt.identity_proof','construct_auxiliary_function','由arccos主值唯一性','arccos x=π/2−arcsin x，故和为π/2，含两个端点。','cos在[0,π]单调，主值唯一。')],
    '主值证明覆盖端点且不需求导；导数路线能训练零导数与连续补端点的条件。','若只为证明恒等式，优先主值互余关系直接覆盖闭区间；若练中值定理则选择导数路线。')
enrich(104,'由严格凸性用x=1处的切线作为全局下界',[
    st(J,'construct_auxiliary_function','φ(x)=x^p/p，φ″=(p−1)x^(p−2)>0','φ严格凸，图像在x=1切线φ(1)+φ′(1)(x−1)=1/p+x−1之上。','x>0,p>1；严格凸函数切线支撑性质已建立。'),
    st(J,'construct_auxiliary_function','φ(x)≥x−1+1/p','用1/q=1−1/p移项得x^p/p+1/q≥x，等号仅x=1。','参数满足共轭指数关系；严格凸性保证等号唯一。')],
    '凸性路线成立，但仍需已建立切线支撑性质；导数符号可以直接验证全域最小。','优先用导数符号直接检查全域最小；掌握凸性时切线法可作结构解释。')
enrich(106,'在对数自变量中使用一次拉格朗日中值定理',[
    st(Y,'construct_auxiliary_function','令t=ln x，F(t)=f(e^t)','F在[ln a,ln b]连续、内部可导，F′(t)=e^t f′(e^t)。','0<a<b；指数换元一一对应区间。'),
    st(Y,'lagrange_mvt','对F使用拉格朗日中值定理','存在η∈(ln a,ln b)，令ξ=e^η，得f(b)−f(a)=ξ f′(ξ)(ln b−ln a)。','F满足中值定理条件；ξ自动落在(a,b)。')],
    '换元后拉格朗日也成立；柯西直接选择ln x可以少建立一个复合函数。','优先柯西中值定理直接与ln x配对，减少换元和复合导数。')
out[101]['question']['routes'][0]['preferred']=False
out[101]['question']['routes'][-1]['preferred']=True
mainchains={
16:[st(N,'squeeze_theorem','三项指数和的n次根','M=e^{|x|}是三个底数中的最大者，M^n≤1+e^{nx}+e^{−nx}≤3M^n。','x固定、n正整数，M≥1。'),st(N,'squeeze_theorem','对正数不等式开n次根','M≤目标≤M·3^(1/n)，两界同趋M。','开根单调；3^(1/n)→1。')],
20:[st(N,'squeeze_theorem','三个底数的n次幂和','c^n≤a^n+b^n+c^n≤3c^n。','0≤a<b<c，故c>0。'),st(N,'squeeze_theorem','对三边开n次根','c≤目标≤c·3^(1/n)→c，夹逼极限为c。','n正整数，三边非负。')],
23:[st(N,'squeeze_theorem','每个求和项的分母介于n²+1与n²+n','k/(n²+n)≤k/(n²+k)≤k/(n²+1)。','1≤k≤n，各分母正。'),st(N,'squeeze_theorem','求和后使用Σk=n(n+1)/2','下界恒1/2；上界n(n+1)/[2(n²+1)]→1/2，所以极限1/2。','有限和保序；上下界同时趋相同值。')],
27:[st(C,'one_sided_limit','先独立看x→0−','e^(1/x)→0，分式→1，arctan(1/x)→−π/2，乘积→−π/2。','x负向趋0，倒数趋−∞。'),st(C,'one_sided_limit','再看x→0+并同除e^(1/x)','分式趋−1，反正切趋π/2，乘积仍−π/2，两侧相同得到两侧极限。','x正向趋0，指数趋+∞；同除正指数合法。')],
29:[st(A,'derivative_definition','令h=−2x，把分子改成标准增量','分子=−[f(x0+h)−f(x0)]，x=−h/2。','h与x同步趋0。'),st(A,'derivative_definition','保留分子反序与分母−1/2','原商=2[f(x0+h)−f(x0)]/h→2f′(x0)=6。','单点导数已给3；两个负号相消。')],
47:[st(E,'derivative_definition','sin函数的增量差商','和差化积得[sin(h/2)/(h/2)]cos(x+h/2)。','x固定，h≠0；正弦恒等式成立。'),st(Z,'important_limit','标准小角比与连续余弦因子','第一因子趋1，第二因子趋cos x，所以导数cos x。','h→0，弧度制。')],
58:[st(E,'chain_rule','arccos是cos在[0,π]的反函数','x∈(−1,1)对应y∈(0,π)，sin y>0，cos的导数−sin y非零。','反函数公式只用于内部非零导数点。'),st(E,'chain_rule','取反函数导数并还原sin y','dy/dx=1/(−sin y)=−1/√(1−x²)。','正值sin y决定平方根符号。')],
59:[st(H,'leibniz_formula','(1+x²)y′=1求n−1阶导','得到(1+x²)y^(n)+2(n−1)x y^(n−1)+(n−1)(n−2)y^(n−2)=0。','n>1整数；二次多项式三阶起导数零。'),st(H,'leibniz_formula','代x=0恢复递推','y^(n)(0)=−(n−1)(n−2)y^(n−2)(0)，由y′(0)=1、y″(0)=0得奇偶通式。','n=2基值直接求导；更高阶用递推保留阶乘。')],
73:[st(E,'chain_rule','随时间的勾股恒等式d²=l²+w²','两端求导2dd′=2ll′+2ww′。','d>0，l与w均可导，两个变化项都保留。'),st(E,'chain_rule','整理速率再代入此时长度','d=13cm，d′=(12·2+5·3)/13=3cm/s。','题面长度记号正规化l=12cm；先求导再代值。')],
74:[st(E,'chain_rule','tan θ=h/500的几何关系','对时间求导sec²θ·θ′=h′/500。','距离固定500，角为弧度，h随时间可导。'),st(E,'chain_rule','由瞬时h=500确定sec²θ=2','θ′=140/(500·2)=0.14rad/min。','先求导后代入瞬时数据；单点θ=π/4不表示θ恒定。')],
90:[st(U,'construct_auxiliary_function','利用闭区间连续导数的有界性','取M≥max|f′|，定义g=f+Mx与h=Mx。','f在[0,1]连续可微，M非负。'),st(U,'monotonicity_analysis','分别检查g与h的导数','g′=f′+M≥0,h′=M≥0，所以都不减且g−h=f。','导数非负给闭区间单调不减。')],
93:[st(B,'construct_auxiliary_function','以圆周长x作优化变量','圆面积x²/(4π)，方形面积(a−x)²/16，所以S是两项之和。','a>0，0≤x≤a。'),st(B,'construct_auxiliary_function','对该二次面积函数配方','S=(π+4)/(16π)[x−aπ/(π+4)]²+a²/[4(π+4)]；正系数平方项最小为0。','使平方项为0的x严格在区间内；两段均正。')],
96:[st(Z,'taylor_expansion','对两项分别保留至四阶','cos x=1−x²/2+x⁴/24+o(x⁴)，e^(−x²/2)=1−x²/2+x⁴/8+o(x⁴)。','相同常数与二阶项会相消，必须保留四阶。'),st(Z,'equiv_infinitesimal','相减分子−x⁴/12+o(x⁴)','分母sin⁴x~x⁴，所得商趋−1/12。','仅替换乘幂中的sin因子，未在相消减法里丢项。')],
97:[st(H,'leibniz_formula','对(1+x²)e^x的100阶导数展开','只保留k=0、1、2三项：其余多项式导数为0。','组合系数C(100,k)必须保留。'),st(H,'leibniz_formula','在0代值使k=1项也消失','k=0给1，k=2给C(100,2)·2=9900，总值9901。','e^x各阶在0为1，多项式二阶为2。')],
99:[st(J,'lagrange_mvt','ln(1+t)在[0,x]应用中值定理','存在ξ∈(0,x)使ln(1+x)=x/(1+ξ)。','x>0；闭区间连续、内区间可导。'),st(J,'inequality_scaling','比较1<1+ξ<1+x','正倒数反向，乘正x得x/(1+x)<ln(1+x)<x。','ξ严格落在两端内保证严格不等号。')],
104:[st(J,'construct_auxiliary_function','构造G=x^p/p+1/q−x','G′=x^(p−1)−1，在(0,1)负，在(1,+∞)正。','p>1，x>0。'),st(J,'construct_auxiliary_function','得到全局唯一最小在1','G(1)=1/p+1/q−1=0，因此G≥0且等号仅x=1。','用全域导数符号与共轭参数关系，不把局部判别冒充全局。')],
106:[st(Y,'cauchy_mvt','选g(x)=ln x并检查柯西条件','存在ξ∈(a,b)使[f(b)−f(a)]/[ln b−ln a]=f′(ξ)/(1/ξ)。','0<a<b；两函数连续可导且g′≠0。'),st(Y,'cauchy_mvt','整理同一中值点的比值','右侧=ξf′(ξ)，端点对数差=ln(b/a)，乘回即所求。','ln(b/a)>0，整理保留同一个ξ。')]
}
for i,steps in mainchains.items():out[i]['question']['routes'][0]['steps']=steps
corrections={19:'原答案0错误；二阶展开或两次有理化给−1/4。',26:'最终1/2正确，但原解答开头在相消差中以x替换tan x无效，保留恒等分解再替换。',56:'原化简常数7/8错误，应5/8；n≥1的导数通式仍正确。',66:'实数定义域不要求每个因子都正；须使用ln|x−c|且排除零点与极点。'}
for i,q in old.items():
    x=src[i-1]
    out[i]=dict(originalId=i,disposition='ready',normalizedQuestion=q['question'],entranceScenarioId=q['entranceScenarioId'],classificationReason=q['metadata']['trainingGoal'],blockers=[],audit={'status':'checked','reasoning':corrections.get(i,q['solution']),'originalAnswerVerdict':'corrected' if i in corrections else 'retained'},question=q)
assert set(out)==set(range(1,108)),str(sorted(set(range(1,108))-set(out)))
(Path(__file__).parent/'review-001-107.json').write_text(json.dumps([out[i] for i in range(1,108)],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
from collections import Counter
print(Counter(x['disposition'] for x in out.values()))
