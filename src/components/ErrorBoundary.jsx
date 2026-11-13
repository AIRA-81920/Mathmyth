import { Component } from 'react';
import { exportBackupFile } from '../core/platform/backup.js';
import { useAppStore } from '../store/appStore.js';
import '../styles/error-boundary.css';

// 界面兜底：任何一页渲染出错时，React 会把整棵树卸掉（白屏）。
// 这里接住错误，只替换出错的那一块，并优先让用户把数据导出来。
// 兜底页不能依赖数据库是否可用：导出失败时仍然显示可读说明。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, busy: false, status: '' };
    this.retry = this.retry.bind(this);
    this.backup = this.backup.bind(this);
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 只写控制台，不弹窗、不打断其它页面；真正的用户提示由下面的兜底页承担。
    try { console.error('[Mathmyth] 界面渲染出错', error, info?.componentStack); } catch { /* 忽略日志失败 */ }
  }

  retry() {
    this.setState({ error: null, status: '' });
    this.props.onRetry?.();
  }

  reload() {
    try { globalThis.location?.reload(); } catch { /* 非浏览器环境忽略 */ }
  }

  async backup() {
    if (this.state.busy) return;
    this.setState({ busy: true, status: '正在导出备份…' });
    try {
      const bytes = await useAppStore.getState().exportData();
      await exportBackupFile(bytes);
      this.setState({ status: '备份已导出。' });
    } catch (error) {
      this.setState({ status: error?.userMessage || '备份暂时导不出来；数据仍在本机，可以先重新加载。' });
    } finally {
      this.setState({ busy: false });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const scope = this.props.scope ? `（${this.props.scope}）` : '';
    return <section className="error-fallback" role="alert" aria-live="assertive">
      <h2>这一页没能正常显示{scope}</h2>
      <p>已经收到的消息和学习记录仍在本机。可以先重试这一页；如果不放心，先导出一份备份。</p>
      <div className="error-fallback-actions">
        <button type="button" className="button button-primary" onClick={this.retry}>重试这一页</button>
        <button type="button" className="button button-secondary" disabled={this.state.busy} onClick={this.backup}>{this.state.busy ? '正在导出…' : '导出备份'}</button>
        <button type="button" className="button button-secondary" onClick={this.reload}>重新加载</button>
      </div>
      {this.state.status && <p className="error-fallback-status" role="status">{this.state.status}</p>}
    </section>;
  }
}
