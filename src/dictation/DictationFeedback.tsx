import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { DictationSession, type DictationStatus, type Phase } from './session';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  target: string;
  value: string;
  onValue: (value: string) => void;
}
const button = 'rounded border bg-white px-3 py-2 text-sm disabled:opacity-50';
export function DictationFeedback({ target, value, onValue, disabled, maxLength = 4000, ...props }: Props) {
  const bridge = window.desktopDictation;
  const text = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ target, value, onValue, disabled }); live.current = { target, value, onValue, disabled };
  const session = useRef<DictationSession>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<DictationStatus>();
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [setup, setSetup] = useState(false);
  useLayoutEffect(() => {
    if (!bridge) return;
    let mounted = true;
    setTranscript(''); setPhase('idle'); setMessage('');
    const controller = new DictationSession(bridge, (next, notice, result) => {
      if (!mounted || live.current.target !== target) return;
      setPhase(next); setMessage(notice || '');
      if (result !== undefined) setTranscript(result);
    });
    session.current = controller;
    const interrupt = () => {
      // Native consent dialogs may blur the parent. Main verifies focus after consent.
      if (controller.phase === 'permission') return;
      controller.cancel('Dictation cancelled because the window changed. Existing feedback is retained.'); setTranscript('');
    };
    const hide = () => { if (document.hidden) interrupt(); };
    const unsubscribe = bridge.onInterrupted(interrupt);
    window.addEventListener('blur', interrupt); document.addEventListener('visibilitychange', hide);
    void bridge.status().then(result => { if (mounted) setStatus(result); }).catch(() => { if (mounted) setStatus({ ready: false, reason: 'Local dictation is unavailable. Typing still works.' }); });
    return () => { mounted = false; controller.cancel(); unsubscribe(); window.removeEventListener('blur', interrupt); document.removeEventListener('visibilitychange', hide); };
  }, [bridge, target]);
  useEffect(() => { if (disabled) { session.current?.cancel(); setTranscript(''); } }, [disabled]);
  async function install() {
    if (!bridge) return;
    setSetup(true); setMessage('');
    try { setStatus(await bridge.install()); } catch (error) { setMessage(error instanceof Error ? error.message : 'Model installation failed.'); }
    finally { setSetup(false); }
  }
  function insert() {
    if (live.current.disabled || !transcript.trim() || !text.current || text.current.matches(':disabled')) return;
    const addition = `${live.current.value ? '\n' : ''}${transcript.trim()}`;
    if (live.current.value.length + addition.length > maxLength) { setMessage(`The combined feedback exceeds ${maxLength.toLocaleString()} characters. Shorten the transcript or feedback first.`); return; }
    const input = text.current, previous = live.current.value;
    input.focus(); input.setSelectionRange(previous.length, previous.length);
    // Chromium's native editing operation retains its undo stack. Fallback stays explicit.
    const inserted = document.execCommand('insertText', false, addition);
    if (!inserted || input.value !== previous + addition) live.current.onValue(previous + addition);
    setTranscript(''); setMessage('Added to this feedback draft. Review it and use the normal Save button.');
  }
  return <span className="block space-y-2">
    <textarea {...props} ref={text} disabled={disabled} maxLength={maxLength} value={value} onChange={event => onValue(event.target.value)} />
    {bridge && !disabled && <span className="block space-y-2" role="group" aria-label="Local feedback dictation">
      <span className="block text-xs">Optional English dictation · processed on this computer · review before Save.</span>
      {!status?.ready && <span className="block text-sm">{status?.reason || 'Checking local speech setup…'}<span className="block">Model: ggml-tiny.en.bin (MIT). Download separately from the official address below on a connected computer; then choose the file here. No download or audio upload happens in this app.</span><span className="block break-all select-text text-xs">https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin</span><button type="button" className={button} disabled={setup || phase !== 'idle'} onClick={() => void install()}>{setup ? 'Installing model…' : 'Choose local speech model'}</button></span>}
      <span className="flex gap-2 flex-wrap">
        {phase === 'idle' && <button type="button" className={button} disabled={!status?.ready || setup || Boolean(transcript)} onClick={() => { setTranscript(''); void session.current?.start(); }}>Start dictation</button>}
        {phase === 'recording' && <button type="button" className={button} onClick={() => void session.current?.stop()}>Stop dictation</button>}
        {phase !== 'idle' && <button type="button" className={button} onClick={() => { session.current?.cancel('Dictation cancelled. Existing feedback is unchanged.'); setTranscript(''); }}>Cancel dictation</button>}
      </span>
      {message && <span className="block text-sm" role="status" aria-live="polite">{message}</span>}
      {transcript && <span className="block space-y-2"><span className="block text-sm">Transcript preview — not added yet</span><textarea aria-label="Review dictated feedback" className="w-full rounded border p-2" value={transcript} onChange={event => setTranscript(event.target.value)} /><button type="button" className={button} onClick={insert}>Add transcript to feedback</button> <button type="button" className={button} onClick={() => { setTranscript(''); setMessage('Transcript discarded. Existing feedback is unchanged.'); }}>Discard transcript</button></span>}
    </span>}
  </span>;
}
