import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ICONS } from '../icons-data.js';
import { t } from '../i18n.js';
import { settings } from '../store.js';

export function Icon({ name, size = 18, class: cls = '', title }) {
  const inner = ICONS[name] || '';
  return (
    <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined} dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + inner }} />
  );
}

export function Btn({ icon, label, onClick, variant = 'default', disabled, title, small, block, class: cls = '', type = 'button', children, iconRight, ...rest }) {
  return (
    <button type={type} class={`btn btn-${variant}${small ? ' btn-sm' : ''}${block ? ' btn-block' : ''} ${cls}`}
      onClick={onClick} disabled={disabled} title={title} aria-label={!label && title ? title : undefined} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {label && <span>{label}</span>}
      {children}
      {iconRight && <Icon name={iconRight} size={small ? 16 : 18} />}
    </button>
  );
}

export function IconBtn({ icon, title, onClick, disabled, active, class: cls = '', size = 20, badge }) {
  return (
    <button type="button" class={`icon-btn${active ? ' active' : ''} ${cls}`} onClick={onClick} disabled={disabled}
      title={title} aria-label={title} aria-pressed={active === undefined ? undefined : !!active}>
      <Icon name={icon} size={size} />
      {badge ? <span class="icon-badge">{badge}</span> : null}
    </button>
  );
}

export function Toggle({ checked, onChange, label, desc, disabled }) {
  return (
    <label class={`toggle-row${disabled ? ' disabled' : ''}`}>
      <span class="toggle-text">
        <span class="toggle-label">{label}</span>
        {desc && <span class="toggle-desc">{desc}</span>}
      </span>
      <span class="switch">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.currentTarget.checked)} />
        <span class="slider" aria-hidden="true" />
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, class: cls = '', ariaLabel }) {
  return (
    <div class={`segmented ${cls}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map(o => (
        <button type="button" role="radio" aria-checked={o.value === value} class={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)} title={o.title} disabled={o.disabled}>
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.render ? o.render() : <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, id, disabled }) {
  return (
    <select class="select" id={id} value={value} disabled={disabled} onChange={e => onChange(e.currentTarget.value)}>
      {options.map(o => <option value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ label, children, hint, for: htmlFor }) {
  return (
    <div class="field">
      {label && <label class="field-label" for={htmlFor}>{label}</label>}
      {children}
      {hint && <div class="field-hint">{hint}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return <span class="spinner" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
}

export function Progress({ value, indeterminate }) {
  return (
    <div class={`progress${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow={indeterminate ? undefined : Math.round((value || 0) * 100)}>
      <div class="progress-bar" style={{ width: indeterminate ? undefined : `${Math.max(0, Math.min(1, value || 0)) * 100}%` }} />
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide, class: cls = '', icon, closeOnBackdrop = true }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusable = el && el.querySelector('input, select, textarea, button:not(.modal-close)');
    (focusable || el)?.focus?.();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev && prev.focus && prev.focus(); };
  }, []);
  return (
    <div class="modal-backdrop" onMouseDown={e => { if (closeOnBackdrop && e.target === e.currentTarget) onClose && onClose(); }}>
      <div class={`modal${wide ? ' modal-wide' : ''} ${cls}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div class="modal-head">
          {icon && <Icon name={icon} size={20} />}
          <h2>{title}</h2>
          {onClose && <button type="button" class="modal-close icon-btn" onClick={onClose} aria-label={t('c.close')} title={t('c.close')}><Icon name="x" /></button>}
        </div>
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toasts ----------
export const toasts = signal([]);
let toastSeq = 0;
export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, message, type, action }];
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}
export function dismissToast(id) { toasts.value = toasts.value.filter(x => x.id !== id); }

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map(x => (
        <div class={`toast toast-${x.type}`} key={x.id}>
          <span>{x.message}</span>
          {x.action && <button type="button" class="toast-action" onClick={() => { x.action.onClick(); dismissToast(x.id); }}>{x.action.label}</button>}
          <button type="button" class="toast-x" onClick={() => dismissToast(x.id)} aria-label={t('c.close')}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------- Confirm ----------
export const confirmState = signal(null);
export function confirmDialog(text, { okLabel, danger } = {}) {
  return new Promise(resolve => { confirmState.value = { text, okLabel, danger, resolve }; });
}
export function ConfirmDialog() {
  const c = confirmState.value;
  if (!c) return null;
  const done = v => { confirmState.value = null; c.resolve(v); };
  return (
    <Modal title={c.text} onClose={() => done(false)} class="modal-confirm"
      footer={<>
        <Btn label={t('c.cancel')} onClick={() => done(false)} />
        <Btn label={c.okLabel || t('c.ok')} variant={c.danger ? 'danger' : 'primary'} onClick={() => done(true)} />
      </>} />
  );
}

// ---------- Chess text ----------
const FIG = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

/** SAN with optional figurines (piece icons instead of letters). */
export function San({ san, class: cls = '' }) {
  if (!san) return null;
  if (!settings.value.figurine) return <span class={`san ${cls}`}>{san}</span>;
  const parts = [];
  let rest = san;
  const lead = /^[NBRQK]/.exec(rest);
  if (lead) { parts.push(<i class={`fig fig-${FIG[lead[0]]}`} aria-label={lead[0]} />); rest = rest.slice(1); }
  const promo = /=([NBRQ])/.exec(rest);
  if (promo) {
    const i = promo.index;
    parts.push(rest.slice(0, i + 1));
    parts.push(<i class={`fig fig-${FIG[promo[1]]}`} aria-label={promo[1]} />);
    parts.push(rest.slice(i + 2));
  } else parts.push(rest);
  return <span class={`san ${cls}`}>{parts}</span>;
}

export const CLS_GLYPH = {
  brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '', forced: '→',
  inaccuracy: '?!', mistake: '?', miss: '✕', blunder: '??',
};

export function ClassIcon({ cls, size = 18, title }) {
  if (!cls) return null;
  return (
    <span class={`cls-icon cls-${cls}`} style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.55)}px` }}
      title={title || t(`cls.${cls}`)} aria-label={title || t(`cls.${cls}`)}>
      {cls === 'book' ? <Icon name="book-open" size={Math.round(size * 0.62)} /> : CLS_GLYPH[cls]}
    </span>
  );
}

export function Kbd({ children }) { return <kbd class="kbd">{children}</kbd>; }

export function formatClock(ms) {
  if (ms === null || ms === undefined) return '';
  const neg = ms < 0;
  const total = Math.max(0, ms);
  if (total < 10000) {
    const s = Math.floor(total / 1000), d = Math.floor((total % 1000) / 100);
    return `${neg ? '-' : ''}0:0${s}.${d}`;
  }
  const secs = Math.ceil(total / 1000);
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  const p = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function downloadText(filename, text, type = 'application/x-chess-pgn') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
