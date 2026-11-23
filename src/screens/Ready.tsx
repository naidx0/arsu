import { useEffect, useRef, useState } from 'react';
import { dayKey, rotatingKey } from '../core/community';
import { CPR_MAX, CPR_MIN, judgePace, paceOf, scorePractice, type Pace, type PracticeScore } from '../core/signal';
import { SCRIPT_BY_SKILL, SCRIPTS, type Skill } from '../data/scripts';
import { hasMotion, hush, metronome, speak, watchCompressions } from '../sensors';
import { personal, usePersonal } from '../store/personal';
import { back, go, timeAgo, useShared, useT } from '../ui/hooks';
import { Button, Card, Icon, Pill, Row, TopBar } from '../ui/kit';

const SESSION_SECONDS = 60;

export function Ready() {
  const { t, lang } = useT();
  const state = usePersonal();
  return (
    <div className="screen">
      <TopBar title={t('ready.title')} onBack={() => go('/')} backLabel={t('common.back')} />
      <p className="lead">{t('ready.lead')}</p>
      {SCRIPTS.map(script => {
        const last = state.practice.find(item => item.skill === script.skill);
        return (
          <Card key={script.skill} tone="low" onClick={() => go(`/ready/${script.skill}`)} label={script.name[lang]}>
            <Row icon={script.icon} tone={script.skill === 'cpr' ? 'error' : 'primary'} title={script.name[lang]}
              sub={<>{script.about[lang]}{last && <><br />{script.skill === 'cpr' ? t('today.lastPractice', { score: last.inTarget, when: timeAgo(last.at, lang) }) : t('ready.lastRead', { when: timeAgo(last.at, lang) })}</>}</>}
              end={<Icon name="chevron_right" />} />
          </Card>
        );
      })}
      <p className="fine">{t('ready.source')}</p>
    </div>
  );
}

/** One first-aid script, step by step. `live` is the same script opened from the emergency screen. */
export function Coach({ skill, live }: { skill: Skill; live: boolean }) {
  const { t, lang } = useT();
  const store = useShared();
  const script = SCRIPT_BY_SKILL.get(skill)!;
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState<PracticeScore | null>(null);
  const step = script.steps[index];
  const last = index === script.steps.length - 1;

  useEffect(() => hush, []);

  const record = (result: PracticeScore) => {
    setScore(result);
    if (live) return;
    const now = Date.now(), current = personal.get();
    personal.set({ practice: [{ ...result, skill, at: now }, ...current.practice].slice(0, 40) });
    void store?.addTraining({ area: current.profile.area, skill, day: dayKey(now), key: rotatingKey(current.secret, now, 365) });
  };
  const finish = () => {
    if (!live && !score && skill !== 'cpr') record({ compressions: 0, averageRate: null, inTarget: 0, seconds: 0 });
    back(live ? '/emergency' : '/ready');
  };

  return (
    <div className={`screen ${live ? 'screen-live' : ''}`}>
      <TopBar title={script.name[lang]} onBack={() => back(live ? '/emergency' : '/ready')} backLabel={t('common.back')}
        actions={<Pill tone={live ? 'error' : 'go'} icon={live ? 'emergency' : 'school'}>{t(live ? 'ready.liveMode' : 'ready.practice')}</Pill>} />
      {live && <Card tone="error"><Row icon="call" title={t('ready.dispatcherFirst')} sub={t('ready.dispatcherBody')} /></Card>}

      <ol className="progress" aria-label={t('ready.steps')}>
        {script.steps.map((item, i) => <li key={i} className={i === index ? 'on' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}><span className="sr-only">{item.title[lang]}</span></li>)}
      </ol>

      <Card tone="high" className="step" label={step.title[lang]}>
        <p className="step-count">{t('ready.stepOf', { n: index + 1, total: script.steps.length })}</p>
        <h2>{step.title[lang]}</h2>
        <p className="step-say">{step.say[lang]}</p>
        <Button variant="tonal" icon="volume_up" onClick={() => speak(`${step.title[lang]}. ${step.say[lang]}`, lang)}>{t('ready.readAloud')}</Button>
      </Card>

      {step.beat && <PaceCoach live={live} onDone={record} />}
      {score && !live && skill === 'cpr' && step.beat && (
        <Card tone={score.inTarget >= 70 ? 'go' : 'soon'} className="score" label={t('ready.score')}>
          <h3>{t('ready.scoreLine', { n: score.inTarget })}</h3>
          <p>{t('ready.scoreDetail', { rate: score.averageRate ?? 0, count: score.compressions, s: score.seconds })}</p>
          <p className="fine">{t('ready.saved')}</p>
        </Card>
      )}

      <div className="actions actions-row">
        <Button variant="outlined" disabled={index === 0} onClick={() => { hush(); setIndex(index - 1); }}>{t('common.back')}</Button>
        {last ? <Button variant="filled" icon="check" onClick={finish}>{t('common.finish')}</Button> : <Button variant="filled" icon="arrow_forward" onClick={() => { hush(); setIndex(index + 1); }}>{t('common.next')}</Button>}
      </div>
      <p className="fine center">{t('ready.source')}</p>
    </div>
  );
}

function PaceCoach({ live, onDone }: { live: boolean; onDone: (score: PracticeScore) => void }) {
  const { t, lang } = useT();
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [left, setLeft] = useState(SESSION_SECONDS);
  const [beatOn, setBeatOn] = useState(true);
  const [sensor, setSensor] = useState<'motion' | 'tap'>('tap');
  const beats = useRef<number[]>([]);
  const stops = useRef<(() => void)[]>([]);
  const spoken = useRef<{ pace: Pace; at: number }>({ pace: 'none', at: 0 });
  const pace = judgePace(rate);

  const onBeat = (time: number) => {
    beats.current.push(time);
    setCount(beats.current.length);
    const current = paceOf(beats.current);
    setRate(current);
    const judged = judgePace(current), now = performance.now();
    // Speak when the pace changes, or every 8 seconds while it is off.
    if (judged !== 'none' && (judged !== spoken.current.pace || (judged !== 'good' && now - spoken.current.at > 8000))) {
      spoken.current = { pace: judged, at: now };
      speak(t(`pace.${judged}`), lang);
    }
  };

  const stop = (report: boolean) => {
    stops.current.forEach(item => item());
    stops.current = [];
    setRunning(false);
    if (report && beats.current.length >= 4) onDone(scorePractice(beats.current));
  };

  const start = async () => {
    beats.current = [];
    spoken.current = { pace: 'none', at: 0 };
    setCount(0); setRate(null); setLeft(SESSION_SECONDS); setRunning(true);
    const motion = hasMotion() ? await watchCompressions(onBeat) : null;
    setSensor(motion ? 'motion' : 'tap');
    if (motion) stops.current.push(motion);
    if (beatOn) stops.current.push(metronome(110));
    if (!live) {
      const started = Date.now();
      const timer = setInterval(() => {
        const remaining = SESSION_SECONDS - Math.floor((Date.now() - started) / 1000);
        setLeft(Math.max(0, remaining));
        if (remaining <= 0) stop(true);
      }, 250);
      stops.current.push(() => clearInterval(timer));
    }
  };
  useEffect(() => () => stops.current.forEach(item => item()), []);

  // Space bar counts as a push, for practising at a desk.
  useEffect(() => {
    if (!running) return;
    const key = (event: KeyboardEvent) => { if (event.code === 'Space' && !event.repeat) { event.preventDefault(); onBeat(performance.now()); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const position = rate === null ? 0 : Math.min(100, Math.max(0, ((rate - 60) / 100) * 100));
  return (
    <Card tone={pace === 'good' ? 'go' : pace === 'none' ? 'low' : 'soon'} className="pace" label={t('pace.title')}>
      <div className="pace-read" aria-live="polite">
        <span className="pace-number" data-testid="pace-rate">{rate ?? '--'}</span>
        <span className="pace-unit">{t('pace.unit')}</span>
        <strong className="pace-word" data-pace={pace}>{t(running ? `pace.${pace}` : 'pace.ready')}</strong>
      </div>
      <div className="pace-scale" aria-hidden="true">
        <i className="pace-target" style={{ left: `${((CPR_MIN - 60) / 100) * 100}%`, width: `${((CPR_MAX - CPR_MIN) / 100) * 100}%` }} />
        {rate !== null && <i className="pace-dot" style={{ left: `${position}%` }} />}
        <span style={{ left: `${((CPR_MIN - 60) / 100) * 100}%` }}>{CPR_MIN}</span>
        <span style={{ left: `${((CPR_MAX - 60) / 100) * 100}%` }}>{CPR_MAX}</span>
      </div>
      <p className="pace-meta">{t('pace.count', { n: count })}{running && !live ? ` · ${t('pace.left', { n: left })}` : ''}</p>

      {running ? (
        <>
          <button type="button" className="tap-pad" onPointerDown={() => onBeat(performance.now())}>
            <Icon name="touch_app" size={32} />
            <span>{t(sensor === 'motion' ? 'pace.tapOrPush' : 'pace.tap')}</span>
          </button>
          <Button variant="outlined" icon="stop" block onClick={() => stop(!live)}>{t('pace.stop')}</Button>
        </>
      ) : (
        <>
          <Button variant="filled" icon="play_arrow" large block onClick={start}>{t(live ? 'pace.startLive' : 'pace.start')}</Button>
          <label className="switch">
            <input type="checkbox" checked={beatOn} onChange={event => setBeatOn(event.target.checked)} />
            <span>{t('pace.beat')}</span>
          </label>
          <p className="fine">{t(hasMotion() ? 'pace.howMotion' : 'pace.howTap')}</p>
        </>
      )}
    </Card>
  );
}
