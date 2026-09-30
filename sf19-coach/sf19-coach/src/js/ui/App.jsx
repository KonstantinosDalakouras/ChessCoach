import { h } from 'preact';
import { t } from '../i18n.js';
import { mode, setMode } from '../app-actions.js';
import { engineManager } from '../engine/manager.js';
import { settings, updateSettings, effectiveThreads } from '../store.js';
import { Icon, IconBtn, Toasts, ConfirmDialog, Btn } from './common.jsx';
import { Dialogs, openDialog } from './dialogs.jsx';
import { PlayView } from './PlayView.jsx';
import { AnalysisView } from './AnalysisView.jsx';
import { LibraryView } from './LibraryView.jsx';
import { MiniBoard } from './Pv.jsx';
import { playState } from '../controllers/play.js';

function fmtMB(bytes) { return `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)}`; }

function EngineChip() {
  const st = engineManager.state.value;
  if (st.status === 'ready') {
    return (
      <button type="button" class="engine-chip ready" onClick={() => openDialog('settings')} title={`${st.name} · ${st.build ? st.build.name : ''}`}>
        <span class="led" /> <span class="chip-text">SF 19{st.build && st.build.variant === 'lite' ? ' Lite' : ''} · {st.threads > 1 ? t('engine.threads', { n: st.threads }) : t('engine.thread1')}</span>
      </button>
    );
  }
  if (st.status === 'error') {
    return (
      <div class="engine-chip error" role="alert">
        <Icon name="triangle-alert" size={15} /> <span class="chip-text">{t('engine.error')}</span>
        <button type="button" class="link-btn" onClick={() => engineManager.start({ variant: settings.value.variant, threads: effectiveThreads(), hash: settings.value.hash })}>{t('engine.retry')}</button>
        {settings.value.variant !== 'lite' && <button type="button" class="link-btn" onClick={() => { updateSettings({ variant: 'lite' }); engineManager.start({ variant: 'lite', threads: effectiveThreads(), hash: settings.value.hash }); }}>{t('engine.useLite')}</button>}
      </div>
    );
  }
  if (st.status === 'loading') {
    const p = st.progress;
    const pct = p && p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : null;
    const downloading = pct !== null && pct < 100;
    return (
      <div class="engine-chip loading" title={t('engine.firstLoad')}>
        <span class="chip-progress" style={{ width: `${pct ?? 0}%` }} />
        <Icon name="loader-circle" size={15} class="spin" />
        <span class="chip-text">
          {downloading ? `${t('engine.downloading')} ${pct}% · ${fmtMB(p.loaded)}/${fmtMB(p.total)} MB` : pct === 100 ? t('engine.compiling') : t('engine.loading')}
        </span>
      </div>
    );
  }
  return null;
}

function Header() {
  const m = mode.value;
  const s = settings.value;
  const tabs = [
    { id: 'play', icon: 'swords', label: t('mode.play') },
    { id: 'analysis', icon: 'microscope', label: t('mode.analysis') },
    { id: 'library', icon: 'library', label: t('mode.library') },
  ];
  return (
    <header class="app-header">
      <div class="brand" title={t('app.tagline')}>
        <span class="brand-logo" aria-hidden="true"><i class="pc pc-knight-white" /></span>
        <span class="brand-name">SF19 <b>Coach</b></span>
      </div>
      <nav class="tabs" role="tablist">
        {tabs.map(tb => (
          <button type="button" role="tab" aria-selected={m === tb.id} class={`tab${m === tb.id ? ' on' : ''}`} onClick={() => setMode(tb.id)}>
            <Icon name={tb.icon} size={17} /><span>{tb.label}</span>
            {tb.id === 'play' && playState.value.status === 'playing' && m !== 'play' && <span class="tab-dot" />}
          </button>
        ))}
      </nav>
      <div class="header-right">
        <EngineChip />
        <button type="button" class="lang-btn" onClick={() => updateSettings({ lang: s.lang === 'el' ? 'en' : 'el' })} title={t('c.language')} aria-label={t('c.language')}>{s.lang === 'el' ? 'EN' : 'ΕΛ'}</button>
        <IconBtn icon="circle-help" title={t('c.help')} onClick={() => openDialog('help')} />
        <IconBtn icon="settings" title={t('c.settings')} onClick={() => openDialog('settings')} />
      </div>
    </header>
  );
}

export function App() {
  const m = mode.value;
  return (
    <div class={`app mode-${m}`}>
      <Header />
      <main class="app-main">
        {m === 'play' && <PlayView />}
        {m === 'analysis' && <AnalysisView />}
        {m === 'library' && <LibraryView />}
      </main>
      <Dialogs />
      <ConfirmDialog />
      <MiniBoard />
      <Toasts />
    </div>
  );
}

export { Btn };
