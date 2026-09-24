import { useRef } from 'react';
import type { ReactNode } from 'react';
import { PlayComposer } from './PlayChrome';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel: () => void;
  pending: boolean;
  error?: string;
  disabled?: boolean;
  maxLength: number;
  label?: string;
  placeholder?: string;
  children?: ReactNode;
}

/** One keyboard, IME, pending/error and submit experience for the whole adventure. */
export function PlayCommandComposer({ id, value, onChange, onSubmit, onCancel, pending, error, disabled = false, maxLength, label = '용사에게 남길 한 줄', placeholder = '용사가 할 행동을 한 줄로 적어 주세요.', children }: Props) {
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const count = [...value].length;
  return <PlayComposer ariaLabel={label} onSubmit={(event) => {
    event.preventDefault();
    const text = input.current?.value ?? value;
    if (pending || disabled || !text.trim() || [...text].length > maxLength) return;
    // Submit clicks are intentional even during IME composition; Enter is guarded below.
    // Blur only after the click lands, so the compact mobile layout cannot move its target.
    input.current?.blur();
    void onSubmit(text);
  }}>
    <label htmlFor={id}>{label}</label>
    <textarea ref={input} id={id} data-play-command value={value} rows={2} placeholder={placeholder}
      disabled={disabled} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
      onChange={(event) => { onCancel(); onChange(event.target.value); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) {
          event.preventDefault();
          if (!pending && !disabled) event.currentTarget.form?.requestSubmit();
        }
      }} />
    <div className="compose-bottom">
      <span className="count">{count} / {maxLength}</span>
      <div className="compose-actions">
        <span className="compose-cancel">{pending ? <button type="button" className="subtle" onClick={onCancel}>취소</button> : null}</span>
        <button type="submit" className="primary" onMouseDown={(event) => {
          // Keep pointer/touch defaults intact so WebKit can synthesize the click.
          // Prevent only the compatibility mouse event from stealing input focus.
          if (event.button === 0 && document.activeElement === input.current) event.preventDefault();
        }} disabled={pending || disabled || !value.trim() || count > maxLength}>
          {pending ? <><span className="pulse" />읽고 있어요…</> : <>기억하고 출발 <span aria-hidden="true">↗</span></>}
        </button>
      </div>
    </div>
    <p className="helper" id={`${id}-help`}>Enter ↵ 한 번이면 읽고 바로 출발해요.</p>
    {error ? <p className="error" id={`${id}-error`} role="alert">{error}</p> : null}
    {children}
  </PlayComposer>;
}
