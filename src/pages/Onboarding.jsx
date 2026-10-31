import { useState } from 'react';
import ModelForm from '../components/ModelForm';
import { SUBJECTS } from '../core/config/subject.js';
import { useAppStore } from '../store/appStore';

export default function Onboarding() {
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);
  const setSubject = useAppStore((state) => state.setSubject);
  // 首启必须显式选学科：本地状态为 null 时“开始使用”不可用。
  // 不把它默认成高数，是为了避免高中用户被直接带进高数骨架。
  const [subject, setSelectedSubject] = useState(null);

  function start() {
    if (!subject) return;
    // 先落学科偏好，再完成模型配置检查；两步成功后一起进入主界面。
    setSubject(subject);
    completeOnboarding();
  }

  return (
    <main className="page onboarding-page">
      <div className="onboarding-content">
        <header className="onboarding-header">
          <h1 className="page-title">先选你在学的数学</h1>
          <p className="page-subtitle muted">高中数学与高等数学的对话、练习和学习记录分开保存，之后可在设置里切换。</p>
        </header>

        <section className="onboarding-subject" aria-labelledby="onboarding-subject-title">
          <h2 className="onboarding-section-title" id="onboarding-subject-title">学科</h2>
          <div className="onboarding-subject-options" role="group" aria-label="选择学科">
            {SUBJECTS.map((entry) => (
              <button key={entry.id} type="button"
                className={'onboarding-subject-option' + (subject === entry.id ? ' is-selected' : '')}
                aria-pressed={subject === entry.id}
                onClick={() => setSelectedSubject(entry.id)}>
                <span className="onboarding-subject-name">{entry.name}</span>
                <span className="onboarding-subject-desc">{entry.description}</span>
              </button>
            ))}
          </div>
          {!subject && <p className="field-hint muted onboarding-subject-hint">请选择一个学科后继续。</p>}
        </section>

        <header className="onboarding-header onboarding-model-header">
          <h2 className="onboarding-section-title">接上你的模型</h2>
          <p className="page-subtitle muted">配置完成后，就可以问自己的题、追问和尝试类似题。</p>
        </header>
        <ModelForm onStart={start} startDisabled={!subject} />
        <footer className="onboarding-promise muted">
          <p>发题后可以继续追问，也可以在解答末尾尝试类似题。</p>
          <p>自己的题与练习会留下来源；「足迹」帮助你找回方法。</p>
        </footer>
      </div>
    </main>
  );
}
