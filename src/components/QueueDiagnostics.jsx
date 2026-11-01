import { useCallback, useEffect, useId, useRef, useState } from 'react';
import ModalFrame from './ModalFrame.jsx';
import { useAppStore } from '../store/appStore.js';
import { usePracticeStore } from '../store/practiceStore.js';
import { useChatPracticeStore } from '../store/chatPracticeStore.js';
import { snapshot, clear, breakdownUsable, breakdownBusy, DIAG_STORAGE_KEY } from '../core/queue/diagnostics.js';
import { claimNextJob, checkpointJob, completeJob, failJob, queueStats } from '../core/db/database.js';
import { locateBlocks, locateEdges } from '../core/ai/locate.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { AiRequestError, waitWithSignal, throwIfAborted } from '../core/ai/transport.js';
import { LOCATION_JOB_TIMEOUT_MS } from '../core/queue/runner.js';

// 隐藏诊断页：只读地展示队列为什么没在跑。
// 入口在设置页「关于」里的版本号连点 5 次；整页与 diagnostics.js 都可以整体删除。
const TIME = (at) => (at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(new Date(at).getMilliseconds()).padStart(3, '0') : '—');
const DURATION = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return ms + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  if (ms < 3600000) return Math.round(ms / 60000) + ' 分钟';
  return (ms / 3600000).toFixed(1) + ' 小时';
};
const VALUE = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (Array.isArray(value) && value.length === 0) return '[]';
  return JSON.stringify(value);
};

function Row({ label, children, pass }) {
  return <div className="queue-diag-row">
    <span className="queue-diag-key">{label}</span>
    <span className={'queue-diag-value' + (pass === undefined ? '' : pass ? ' is-pass' : ' is-fail')}>{children}</span>
  </div>;
}

export default function QueueDiagnostics({ onClose }) {
  const id = useId();
  const closeRef = useRef(null);
  const requestRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [stats, setStats] = useState({ status: 'loading', data: null, error: '' });
  const [confirmRun, setConfirmRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState([]);
  const [note, setNote] = useState('');

  const refreshStats = useCallback(async () => {
    setStats((previous) => ({ ...previous, status: 'loading', error: '' }));
    try {
      const data = await queueStats();
      setStats({ status: 'ready', data, error: '' });
    } catch (error) {
      // storageStatus==='error' 时这里必然失败：页面照常显示，只是数据库统计不可用。
      setStats({ status: 'failed', data: null, error: (error?.userMessage || error?.message || String(error)) });
    }
  }, []);

  useEffect(() => { refreshStats(); }, [refreshStats]);
  useEffect(() => () => requestRef.current?.abort(), []);
  // 每秒重绘一次：只想让"最后活动时间/是否在跑"这类读数保持新鲜，不做任何订阅。
  useEffect(() => { const timer = setInterval(() => setTick((value) => value + 1), 1000); return () => clearInterval(timer); }, []);

  const snap = snapshot();
  const app = useAppStore.getState();
  const liveUsable = breakdownUsable(app);
  const liveBusy = breakdownBusy({ practice: usePracticeStore.getState(), chat: useChatPracticeStore.getState(),
    streamingCount: typeof app.streamingCount === 'number' ? app.streamingCount : null });
  const queue = snap.queue;

  async function runOnce() {
    setConfirmRun(false);
    setRunning(true);
    setRunLog([]);
    setNote('');
    const log = [];
    const push = (line) => { log.push(TIME(Date.now()) + ' ' + line); setRunLog(log.slice()); };
    let claim;
    let deadline;
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      claim = await claimNextJob();
      push('claimNextJob → ' + (claim ? JSON.stringify({ id: claim.id, phase: claim.payload?.phase, attempts: claim.attempts }) : 'null（没有可领取的任务）'));
      if (!claim) { setNote('没有可领取的任务：队列表里没有满足条件的 pending 任务。'); return; }
      deadline = setTimeout(() => controller.abort(new AiRequestError('本题路径整理超时。', 'location_timeout')), LOCATION_JOB_TIMEOUT_MS);
      const config = { ...useAppStore.getState().modelConfig };
      const skeleton = await waitWithSignal(loadSkeleton(), controller.signal);
      push('loadSkeleton → ok');
      let blockIds = claim.payload.blockIds ?? [];
      if (claim.payload.phase !== 'edges') {
        const location = await waitWithSignal(locateBlocks({ config, source: claim.payload.source, skeleton, signal: controller.signal }), controller.signal);
        blockIds = Array.isArray(location) ? location : location.blockIds;
        push('locateBlocks → ' + JSON.stringify(location));
        const checkpoint = await checkpointJob(claim, blockIds, Array.isArray(location) ? undefined : location);
        push('checkpointJob → ' + JSON.stringify(checkpoint));
      }
      const entries = claim.payload.classificationOnly ? [] : await waitWithSignal(locateEdges({ config, source: claim.payload.source, skeleton, blockIds, signal: controller.signal }), controller.signal);
      throwIfAborted(controller.signal);
      clearTimeout(deadline);
      push('locateEdges → ' + JSON.stringify(entries).slice(0, 300));
      const result = await completeJob(claim, entries);
      push('completeJob → ' + JSON.stringify(result));
      setNote('试跑完成。');
    } catch (error) {
      push('异常 → ' + (error?.name || 'Error') + ': ' + (error?.message ?? String(error)) + '\n' + String(error?.stack ?? '').slice(0, 400));
      setNote('试跑失败，错误原文见下方。');
      // 把租约还给队列，避免任务永远停在 running（与 runner 自己的失败处理一致）。
      if (claim) {
        try { push('failJob → ' + JSON.stringify(await failJob(claim, { cancelled: error?.name === 'AbortError' && controller.signal.reason?.code !== 'location_timeout' }))); }
        catch (failError) { push('failJob 也失败 → ' + (failError?.message ?? String(failError))); }
      }
    } finally {
      clearTimeout(deadline);
      requestRef.current = null;
      setRunning(false);
      refreshStats();
    }
  }

  return (
    <ModalFrame open titleId={`${id}-title`} className="queue-diag" onClose={onClose} initialFocusRef={closeRef}>
      <header className="queue-diag-header">
        <h2 id={`${id}-title`}>队列诊断</h2>
        <span className="muted queue-diag-sub">只观察，不改变任何判断</span>
        <button ref={closeRef} type="button" className="icon-button" aria-label="关闭队列诊断" onClick={onClose}>✕</button>
      </header>
      <div className="queue-diag-body" data-tick={tick}>
        <section className="queue-diag-section" aria-label="队列状态">
          <h3>队列状态</h3>
          <Row label="是否启动过" pass={Boolean(queue.startedAt)}>{queue.startedAt ? '是，' + TIME(queue.startedAt) : '否（startQueue 从未被调用）'}</Row>
          <Row label="最后活动时间" pass={queue.lastActivityAt ? true : false}>{queue.lastActivityAt ? TIME(queue.lastActivityAt) + ' · ' + DURATION(queue.idleMs) + ' 前' : '从未（pump 一次都没进来）'}</Row>
          <Row label="是否被 dispose">{queue.disposedAt ? '是，' + TIME(queue.disposedAt) : '否'}</Row>
          <Row label="当前 running">{String(queue.running)}</Row>
          <Row label="timer 是否存在">{String(queue.hasTimer)}</Row>
          <Row label="最近一次退出">{queue.lastExit ?? '—'}</Row>
        </section>

        <section className="queue-diag-section" aria-label="usable 条件">
          <h3>usable() 逐项 {liveUsable.ok ? '→ true（可以跑）' : '→ false（队列会直接返回）'}</h3>
          {liveUsable.items.map((item) => <Row key={item.key} label={item.key} pass={item.pass}>{String(item.pass)} · {VALUE(item.value)}</Row>)}
        </section>

        <section className="queue-diag-section" aria-label="busy 条件">
          <h3>foregroundBusy() 逐项 {liveBusy.busy ? '→ true（会一直让位给前台）' : '→ false'}</h3>
          {liveBusy.items.map((item) => <Row key={item.key} label={item.key} pass={!item.pass}>{String(item.pass)} · {VALUE(item.value)}</Row>)}
          <Row label="最近一次 pump 的读数">{snap.usable ? 'usable=' + snap.usable.ok + ' busy=' + (snap.busy?.busy ?? '—') : '—'}</Row>
        </section>

        <section className="queue-diag-section" aria-label="数据库统计">
          <h3>数据库队列 <button type="button" className="queue-diag-link" onClick={refreshStats}>刷新</button></h3>
          {stats.status === 'failed' && <p className="queue-diag-error">读取失败（存储可能已不可用）：{stats.error}</p>}
          {stats.status !== 'failed' && !stats.data && <p className="muted">读取中…</p>}
          {stats.data && <>
            <Row label="pending / running / failed">{stats.data.pending + ' / ' + stats.data.running + ' / ' + stats.data.failed}</Row>
            <Row label="done">{stats.data.done}</Row>
            <Row label="可领取数（与 claimNextJob 同条件）" pass={stats.data.claimable > 0}>{stats.data.claimable}</Row>
            <Row label="最旧 pending 创建时间">{stats.data.createdAtOfOldestPending ?? '—'}</Row>
            <Row label="最旧 pending 年龄">{DURATION(stats.data.ageOfOldestPendingMs)}</Row>
          </>}
        </section>

        <section className="queue-diag-section" aria-label="最近诊断事件">
          <h3>最近 30 条事件（共 {snap.eventCount} 条，上限 200）</h3>
          {!snap.events.length && <p className="muted">还没有事件。</p>}
          <ol className="queue-diag-events">
            {snap.events.slice(-30).reverse().map((event, index) => <li key={event.at + '-' + index} className={'queue-diag-event is-' + event.level}>
              <span className="queue-diag-time">{TIME(event.at)}</span>
              <span className="queue-diag-code">{event.code}</span>
              <span className="queue-diag-detail">{event.detail}</span>
            </li>)}
          </ol>
        </section>

        <section className="queue-diag-section" aria-label="立即试跑一次">
          <h3>立即试跑一次</h3>
          <p className="muted queue-diag-hint">直接领取一个任务并走完 blocks / edges / completeJob，会花真实模型调用。结果与异常原文会打在这里。</p>
          {!confirmRun && <button type="button" className="button button-secondary" disabled={running} onClick={() => setConfirmRun(true)}>{running ? '试跑中…' : '立即试跑一次'}</button>}
          {confirmRun && <div className="queue-diag-confirm">
            <p>确认真的要试跑一次？这会消耗一次真实模型调用。</p>
            <div className="dialog-actions">
              <button type="button" className="button button-secondary" onClick={() => setConfirmRun(false)}>取消</button>
              <button type="button" className="button" onClick={runOnce}>确认试跑</button>
            </div>
          </div>}
          {note && <p className="queue-diag-note">{note}</p>}
          {runLog.length > 0 && <ol className="queue-diag-events">{runLog.map((line, index) => <li key={index} className="queue-diag-event is-info"><span className="queue-diag-detail queue-diag-pre">{line}</span></li>)}</ol>}
        </section>

        <section className="queue-diag-section" aria-label="清空诊断">
          <button type="button" className="button button-secondary" onClick={() => { clear(); setTick((value) => value + 1); }}>清空诊断</button>
          <p className="muted queue-diag-hint">清空内存与 localStorage（{DIAG_STORAGE_KEY}）里的全部事件。</p>
        </section>
      </div>
    </ModalFrame>
  );
}
