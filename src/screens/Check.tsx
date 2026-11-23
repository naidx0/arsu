import { useEffect, useMemo, useRef, useState } from 'react';
import { describePhoto, findSigns, summarise } from '../ai/brain';
import { dayKey, rotatingKey, type Signal } from '../core/community';
import { checkMedicines } from '../core/meds';
import { buildNote, reasonText, type AiTier, type Vitals } from '../core/note';
import type { PulseReading } from '../core/signal';
import { matchSigns, triage } from '../core/triage';
import { SIGN_BY_ID, SIGNS, type Level, type SignId } from '../data/protocol';
import { canListen, listen, measurePulse, recordCoughs, type PulseUpdate } from '../sensors';
import { personal, usePersonal } from '../store/personal';
import { go, isDemoRun, useOnline, useShared, useT } from '../ui/hooks';
import { Button, Card, Chip, Field, Icon, Pill, Row, Sheet, TopBar } from '../ui/kit';

export const LEVEL_ICON: Record<Level, string> = { emergency: 'emergency', urgent: 'warning', soon: 'schedule', routine: 'check_circle' };
export const LEVEL_TONE: Record<Level, 'error' | 'urgent' | 'soon' | 'go'> = { emergency: 'error', urgent: 'urgent', soon: 'soon', routine: 'go' };

const RED_FLAGS: SignId[] = ['chest_pain', 'breathing', 'stroke', 'bleeding', 'unresponsive'];
const COMMON: SignId[] = ['cough', 'sore_throat', 'fever', 'headache', 'vomiting', 'diarrhea', 'rash', 'dizzy', 'tired'];
const DURATIONS = [{ key: 'today', days: 1 }, { key: 'few', days: 3 }, { key: 'several', days: 5 }, { key: 'week', days: 7 }];

type Step = 'tell' | 'measure' | 'result';

export function Check() {
  const { t, lang } = useT();
  const state = usePersonal();
  const store = useShared();
  const online = useOnline();
  const [step, setStep] = useState<Step>('tell');
  const [words, setWords] = useState('');
  const [added, setAdded] = useState<SignId[]>([]);
  const [removed, setRemoved] = useState<SignId[]>([]);
  const [fromAi, setFromAi] = useState<SignId[]>([]);
  const [tier, setTier] = useState<AiTier>('rules');
  const [days, setDays] = useState<number>();
  const [showAll, setShowAll] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [vitals, setVitals] = useState<Vitals>({});
  const [photo, setPhoto] = useState<{ url: string; blob: Blob } | null>(null);
  const [sheet, setSheet] = useState<'pulse' | 'cough' | null>(null);
  const [sent, setSent] = useState<'no' | 'sending' | 'yes'>('no');
  const [summaryTier, setSummaryTier] = useState<AiTier>('rules');
  const stopListening = useRef<() => void>(() => {});

  const heard = useMemo(() => matchSigns(words), [words]);
  const signs = useMemo(() => [...new Set([...heard, ...fromAi, ...added])].filter(id => !removed.includes(id)), [heard, fromAi, added, removed]);
  const age = state.profile.birthYear ? new Date().getFullYear() - state.profile.birthYear : undefined;
  const result = useMemo(() => triage({ signs, pulse: vitals.pulse, ageYears: age, days }), [signs, vitals.pulse, age, days]);
  const redNow = signs.some(id => SIGN_BY_ID.get(id)?.level === 'emergency');

  useEffect(() => () => stopListening.current(), []);

  const toggle = (id: SignId) => {
    if (signs.includes(id)) { setAdded(list => list.filter(item => item !== id)); setRemoved(list => [...list, id]); }
    else { setRemoved(list => list.filter(item => item !== id)); setAdded(list => [...list, id]); }
  };
  const mic = () => {
    if (listening) { stopListening.current(); return; }
    const before = words.trim();
    setListening(true);
    stopListening.current = listen(lang, text => setWords(before ? `${before} ${text}` : text), () => setListening(false));
  };

  /** Ask the best available model to read the words, then move on. Keyword matches are already in. */
  const understand = async (next: Step) => {
    stopListening.current();
    if (words.trim().length >= 3) {
      setThinking(true);
      const found = await findSigns(words, lang);
      setFromAi(found.signs);
      setTier(found.tier);
      setThinking(false);
      if (found.signs.some(id => SIGN_BY_ID.get(id)?.level === 'emergency' && !removed.includes(id))) next = 'result';
    }
    setStep(next);
    window.scrollTo(0, 0);
  };

  // Anonymous: an area, a symptom group and a day. See docs/SAFETY.md.
  const shareSignals = () => {
    if (!store || !state.share || !signs.length) return;
    const now = Date.now(), key = rotatingKey(state.secret, now, 7);
    const groups = [...new Set(signs.map(id => SIGN_BY_ID.get(id)!.group).filter(group => group !== 'other'))];
    const signals: Signal[] = groups.map(group => ({ area: state.profile.area, group, day: dayKey(now), key }));
    if (signals.length) void store.addSignals(signals);
  };

  const showResult = async () => { await understand('result'); };
  useEffect(() => { if (step === 'result') shareSignals(); }, [step, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!store) return;
    setSent('sending');
    const findings = checkMedicines(state.medicines);
    const id = crypto.randomUUID();
    let note = buildNote({ id, ownerId: personal.get().ownerId, now: Date.now(), profile: state.profile, signs, words, days, vitals, medicines: state.medicines, findings, result, aiTier: tier, hasPhoto: Boolean(photo) });
    // The facts above are final. A model may add a plain summary; the guard decides if it stays.
    const written = await summarise(note);
    setSummaryTier(written.tier);
    const seen = photo ? await describePhoto(photo.blob, lang) : null;
    const summary = [written.summary, seen].filter(Boolean).join(' ') || undefined;
    note = { ...note, summary, aiTier: written.summary ? written.tier : tier };
    await store.sendNote(note);
    personal.set(current => ({ notes: [note, ...current.notes].slice(0, 30) }));
    setSent('yes');
  };

  const tone = LEVEL_TONE[result.level];
  const chips = showAll ? SIGNS.filter(sign => !RED_FLAGS.includes(sign.id)).map(sign => sign.id) : [...new Set([...COMMON, ...signs.filter(id => !RED_FLAGS.includes(id))])];

  return (
    <div className="screen">
      <TopBar title={t(step === 'result' ? 'check.resultTitle' : 'check.title')} onBack={() => (step === 'tell' ? go('/') : setStep(step === 'result' ? 'measure' : 'tell'))} backLabel={t('common.back')} />

      {step === 'tell' && (
        <>
          <Card tone="low">
            <h2 className="card-title">{t('check.tell')}</h2>
            <label className="say">
              <span className="sr-only">{t('check.tell')}</span>
              <textarea value={words} onChange={event => setWords(event.target.value)} placeholder={t('check.placeholder')} rows={3} />
            </label>
            <div className="say-actions">
              {canListen() && <Button variant={listening ? 'danger' : 'tonal'} icon={listening ? 'stop' : 'mic'} onClick={mic}>{t(listening ? 'check.stop' : 'check.speak')}</Button>}
              {listening && <span className="live" aria-live="polite"><Icon name="graphic_eq" size={18} /> {t('check.listening')}</span>}
            </div>
          </Card>

          <section className="group" aria-label={t('check.redFlags')}>
            <h3 className="group-title group-title-urgent"><Icon name="emergency" fill size={18} /> {t('check.redFlags')}</h3>
            <div className="chips">
              {RED_FLAGS.map(id => <Chip key={id} tone="urgent" selected={signs.includes(id)} onClick={() => toggle(id)}>{SIGN_BY_ID.get(id)!.label[lang]}</Chip>)}
            </div>
          </section>

          <section className="group" aria-label={t('check.other')}>
            <h3 className="group-title">{t('check.other')}</h3>
            <div className="chips">
              {chips.map(id => <Chip key={id} selected={signs.includes(id)} tone={SIGN_BY_ID.get(id)!.level === 'emergency' ? 'urgent' : undefined} onClick={() => toggle(id)}>{SIGN_BY_ID.get(id)!.label[lang]}</Chip>)}
              <Chip icon={showAll ? 'close' : 'add'} onClick={() => setShowAll(value => !value)}>{t(showAll ? 'check.fewer' : 'check.more')}</Chip>
            </div>
          </section>

          <section className="group" aria-label={t('check.howLong')}>
            <h3 className="group-title">{t('check.howLong')}</h3>
            <div className="chips">
              {DURATIONS.map(item => <Chip key={item.key} selected={days === item.days} onClick={() => setDays(days === item.days ? undefined : item.days)}>{t(`check.dur.${item.key}`)}</Chip>)}
            </div>
          </section>

          {redNow && (
            <Card tone="error" className="alert">
              <Row icon="emergency" title={t('check.redNow')} sub={t('check.redNowBody')} />
              <Button variant="danger" icon="arrow_forward" block large onClick={showResult}>{t('check.seeWhat')}</Button>
            </Card>
          )}

          <div className="actions">
            <Button variant="filled" large block icon="arrow_forward" disabled={thinking || (!signs.length && words.trim().length < 3)} onClick={() => understand(redNow ? 'result' : 'measure')}>{t(thinking ? 'check.thinking' : 'common.next')}</Button>
          </div>
        </>
      )}

      {step === 'measure' && (
        <>
          <p className="lead">{t('check.measureLead')}</p>
          <Card tone="low" onClick={() => setSheet('pulse')} label={t('check.pulse')}>
            <Row icon="ecg_heart" tone="error" title={t('check.pulse')} sub={vitals.pulse ? t('check.pulseValue', { n: vitals.pulse }) : t('check.pulseBody')} end={vitals.pulse ? <Pill tone="go" icon="check_circle">{t('common.done')}</Pill> : <Icon name="chevron_right" />} />
          </Card>
          <Card tone="low" onClick={() => setSheet('cough')} label={t('check.cough')}>
            <Row icon="pulmonology" tone="primary" title={t('check.cough')} sub={vitals.coughs !== undefined ? t('check.coughValue', { n: vitals.coughs, s: vitals.coughSeconds ?? 15 }) : t('check.coughBody')} end={vitals.coughs !== undefined ? <Pill tone="go" icon="check_circle">{t('common.done')}</Pill> : <Icon name="chevron_right" />} />
          </Card>
          <Card tone="low">
            <Row icon="photo_camera" tone="soon" title={t('check.photo')} sub={photo ? t('check.photoKept') : t('check.photoBody')}
              end={photo ? <img className="thumb" src={photo.url} alt={t('check.photo')} /> : null} />
            <label className="btn btn-tonal file-btn">
              <Icon name="photo_camera" size={20} fill /><span>{t(photo ? 'check.photoRetake' : 'check.photoTake')}</span>
              <input type="file" accept="image/*" capture="environment" onChange={event => { const file = event.target.files?.[0]; if (file) setPhoto({ url: URL.createObjectURL(file), blob: file }); }} />
            </label>
          </Card>
          <div className="actions">
            <Button variant="filled" large block icon="arrow_forward" disabled={thinking} onClick={showResult}>{t('check.seeResult')}</Button>
          </div>
        </>
      )}

      {step === 'result' && (
        <>
          <Card tone={tone} className="result" label={t(`level.${result.level}`)}>
            <span className="result-icon"><Icon name={LEVEL_ICON[result.level]} fill size={40} /></span>
            <h2 data-level={result.level}>{t(signs.length ? `level.${result.level}` : 'level.none')}</h2>
            <p>{t(signs.length ? `level.${result.level}.body` : 'level.none.body')}</p>
            {result.level === 'emergency' && (
              isDemoRun()
                ? <Button variant="danger" large block icon="call" onClick={() => alert(t('sos.demoCall'))}>{t('sos.call')}</Button>
                : <a className="btn btn-danger btn-large btn-block" href="tel:911"><Icon name="call" fill /><span>{t('sos.call')}</span></a>
            )}
          </Card>

          <Card tone="low" label={t('check.doNow')}>
            <h3 className="card-title">{t('check.doNow')}</h3>
            <ol className="steps">
              {result.actions.map(action => <li key={action}>{t(action)}</li>)}
            </ol>
            {result.level === 'emergency' && <Button variant="tonal" icon="health_and_safety" onClick={() => go(`/ready/${signs.includes('bleeding') ? 'bleeding' : signs.includes('overdose') ? 'naloxone' : signs.includes('choking') ? 'choking' : 'cpr'}?live`)}>{t('check.firstAid')}</Button>}
            {result.level !== 'emergency' && signs.length > 0 && <a className="btn btn-outlined" href="tel:811"><Icon name="call" size={20} fill /><span>{t('check.call811')}</span></a>}
          </Card>

          {result.reasons.length > 0 && (
            <details className="why">
              <summary><Icon name="info" size={20} /> {t('check.why')} <Icon name="expand_more" size={20} className="why-caret" /></summary>
              <ul>
                {result.reasons.map((reason, index) => (
                  <li key={index}><strong>{reasonText(reason, lang)}</strong><span>{t(`level.${reason.level}.short`)} · {reason.basis}</span></li>
                ))}
              </ul>
              <p className="fine">{t('check.protocolNote')}</p>
            </details>
          )}

          {signs.length > 0 && (
            <Card tone="low" label={t('check.nurse')}>
              <Row icon="local_hospital" tone="primary" title={t('check.nurse')} sub={t(sent === 'yes' ? (online ? 'check.sentOnline' : 'check.sentOffline') : 'check.nurseBody')} />
              {sent === 'yes'
                ? <p className="fine"><Icon name={summaryTier === 'rules' ? 'verified_user' : 'auto_awesome'} size={16} fill /> {t(`note.by.${summaryTier}`)}</p>
                : <Button variant="filled" icon="arrow_forward" block disabled={sent === 'sending'} onClick={send}>{t(sent === 'sending' ? 'check.sending' : 'check.send')}</Button>}
            </Card>
          )}

          <div className="actions">
            <Button variant="text" onClick={() => go('/')}>{t('common.finish')}</Button>
          </div>
          <p className="fine center">{t('check.disclaimer')}</p>
        </>
      )}

      <PulseSheet open={sheet === 'pulse'} onClose={() => setSheet(null)} onUse={bpm => { setVitals(value => ({ ...value, pulse: bpm })); personal.set(current => ({ pulses: [{ at: Date.now(), bpm }, ...current.pulses].slice(0, 60) })); setSheet(null); }} />
      <CoughSheet open={sheet === 'cough'} onClose={() => setSheet(null)} onUse={(coughs, seconds) => { setVitals(value => ({ ...value, coughs, coughSeconds: seconds })); setSheet(null); }} />
    </div>
  );
}

function PulseSheet({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (bpm: number) => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [update, setUpdate] = useState<PulseUpdate | null>(null);
  const [locked, setLocked] = useState<PulseReading | null>(null);
  const [error, setError] = useState(false);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!open) return;
    setUpdate(null); setLocked(null); setError(false); setManual('');
    let stop = () => {}, cancelled = false;
    const element = video.current;
    if (element) {
      measurePulse(element, next => { setUpdate(next); if (next.reading && next.seconds >= 12) setLocked(current => current ?? next.reading); })
        .then(session => { if (cancelled) session.stop(); else stop = () => session.stop(); })
        .catch(() => setError(true));
    }
    return () => { cancelled = true; stop(); };
  }, [open]);

  const typed = Number(manual);
  const typedOk = Number.isInteger(typed) && typed >= 25 && typed <= 230;
  const progress = Math.min(1, (update?.seconds ?? 0) / 12);
  return (
    <Sheet open={open} onClose={onClose} title={t('check.pulse')}>
      {!error && (
        <div className="pulse">
          <div className="pulse-view">
            <video ref={video} muted playsInline />
            <svg className="pulse-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" /><circle cx="60" cy="60" r="54" className="pulse-ring-fill" strokeDasharray={`${progress * 339} 339`} /></svg>
            <span className="pulse-number">{locked ? locked.bpm : update?.reading ? update.reading.bpm : '--'}</span>
          </div>
          <p className="pulse-hint" aria-live="polite">{locked ? t('pulse.done') : !update ? t('pulse.starting') : !update.covered ? t('pulse.cover') : t('pulse.hold', { n: Math.max(0, Math.ceil(12 - update.seconds)) })}</p>
          {update && update.trace.length > 10 && <Trace values={update.trace} />}
          {locked && <Button variant="filled" block large icon="check" onClick={() => onUse(locked.bpm)}>{t('pulse.use', { n: locked.bpm })}</Button>}
        </div>
      )}
      {error && <p className="lead">{t('pulse.noCamera')}</p>}
      <div className="manual">
        <Field label={t('pulse.manual')} value={manual} onChange={setManual} inputMode="numeric" placeholder="72" id="pulse-manual" />
        <Button variant="tonal" disabled={!typedOk} onClick={() => onUse(typed)}>{t('common.use')}</Button>
      </div>
      <p className="fine">{t('pulse.note')}</p>
    </Sheet>
  );
}

function Trace({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 300},${40 - ((value - min) / span) * 36 - 2}`).join(' ');
  return <svg className="trace" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function CoughSheet({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (coughs: number, seconds: number) => void }) {
  const { t } = useT();
  const SECONDS = 15;
  const [phase, setPhase] = useState<'ready' | 'recording' | 'done' | 'error'>('ready');
  const [level, setLevel] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [count, setCount] = useState(0);
  useEffect(() => { if (open) { setPhase('ready'); setLevel(0); setLeft(SECONDS); } }, [open]);
  const start = async () => {
    setPhase('recording');
    try {
      const outcome = await recordCoughs(SECONDS, (loudness, remaining) => { setLevel(loudness); setLeft(Math.ceil(remaining)); });
      setCount(outcome.coughs);
      setPhase('done');
    } catch { setPhase('error'); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('check.cough')}>
      <p className="lead">{t(phase === 'error' ? 'cough.noMic' : phase === 'done' ? 'cough.result' : 'cough.how', { n: count, s: SECONDS })}</p>
      {phase === 'recording' && (
        <div className="meter" role="status" aria-label={t('check.listening')}>
          <div className="meter-bar"><i style={{ width: `${Math.min(100, level * 400)}%` }} /></div>
          <span>{t('cough.left', { n: left })}</span>
        </div>
      )}
      {phase === 'ready' && <Button variant="filled" block large icon="mic" onClick={start}>{t('cough.start')}</Button>}
      {phase === 'done' && <Button variant="filled" block large icon="check" onClick={() => onUse(count, SECONDS)}>{t('common.use')}</Button>}
      <p className="fine">{t('cough.note')}</p>
    </Sheet>
  );
}
