import { useCallback, useEffect, useRef, useState } from 'react';

interface PlayCommandOptions<T> {
  contextKey: string;
  maxLength: number;
  timeoutMs: number;
  blocked: boolean;
  interpret: (text: string, signal: AbortSignal) => Promise<T>;
  execute: (value: T, text: string) => Promise<boolean | void>;
  onSuccess?: () => void;
  onStart?: () => void;
}

/** The single input → interpretation → saved execution pipeline used by every chapter. */
export function usePlayCommand<T>(options: PlayCommandOptions<T>) {
  const live = useRef(options);
  live.current = options;
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setPending(false);
  }, []);
  useEffect(() => {
    cancel();
    setError('');
    return cancel;
  }, [options.contextKey, cancel]);
  const submit = useCallback(async (draft: string) => {
    const current = live.current;
    if (request.current || current.blocked) return;
    const text = draft.trim();
    if (!text) { setError('용사에게 남길 한 줄을 적어 주세요.'); return; }
    if ([...text].length > current.maxLength) { setError(`한 줄은 ${current.maxLength}자까지 쓸 수 있어요.`); return; }
    const controller = new AbortController();
    request.current = controller;
    const token = ++generation.current;
    setPending(true);
    setError('');
    current.onStart?.();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, current.timeoutMs);
    try {
      const value = await current.interpret(text, controller.signal);
      if (timedOut && token === generation.current) throw new Error('응답이 늦어 출발을 멈췄어요.');
      if (controller.signal.aborted || token !== generation.current || live.current.contextKey !== current.contextKey || live.current.blocked) return;
      clearTimeout(timer);
      const saved = await current.execute(value, text);
      if (token !== generation.current || controller.signal.aborted) return;
      if (saved === false) throw new Error('기록하지 못해 출발을 멈췄어요. 쓴 문장은 그대로예요.');
      current.onSuccess?.();
    } catch (cause) {
      if (token === generation.current) setError(timedOut
        ? '응답이 늦어 출발을 멈췄어요. 쓴 문장은 그대로예요. 다시 시도해 주세요.'
        : cause instanceof Error ? cause.message : '뜻을 읽지 못했어요. 쓴 문장은 그대로예요.');
    } finally {
      clearTimeout(timer);
      if (token === generation.current) { request.current = null; setPending(false); }
    }
  }, []);
  return { pending, error, submit, cancel, clearError: () => setError('') };
}
