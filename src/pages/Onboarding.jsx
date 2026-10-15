import ModelForm from '../components/ModelForm';
import { useAppStore } from '../store/appStore';

export default function Onboarding() {
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);

  return (
    <main className="page onboarding-page">
      <div className="onboarding-content">
        <header className="onboarding-header">
          <h1 className="page-title">先接上你的模型</h1>
          <p className="page-subtitle muted">填一次就行，以后不用再管</p>
        </header>
        <ModelForm onStart={completeOnboarding} />
        <footer className="onboarding-promise muted">
          <p>贴一道题，它解给你看，同时悄悄记着。</p>
          <p>想看它记了什么，点上面「足迹」。</p>
        </footer>
      </div>
    </main>
  );
}
