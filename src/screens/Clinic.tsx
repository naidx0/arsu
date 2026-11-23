import { useEffect, useMemo, useState } from 'react';
import { clusters, dayKey, readiness, type Signal, type Training } from '../core/community';
import type { Note } from '../core/note';
import { LEVEL_ORDER, SIGN_BY_ID, type Level } from '../data/protocol';
import { personal } from '../store/personal';
import { clearSample, loadSample } from '../store/shared';
import { go, timeAgo, useShared, useT } from '../ui/hooks';
import { Button, Card, Chip, Icon, IconButton, Pill, Row } from '../ui/kit';
import { LEVEL_ICON, LEVEL_TONE } from './Check';
import { AREAS } from './Settings';

const rank = (level: Level) => LEVEL_ORDER.indexOf(level);

export function Clinic() {
  const { t, lang } = useT();
  const store = useShared();
  const [access, setAccess] = useState<{ ok: boolean; uid?: string; reason?: string } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [training, setTraining] = useState<Training[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { if (store) void store.clinicAccess().then(setAccess); }, [store]);
  useEffect(() => {
    if (!store || !access?.ok) return;
    const stops = [store.watchNotes(setNotes, () => setFailed(true)), store.watchSignals(setSignals), store.watchTraining(setTraining)];
    return () => stops.forEach(stop => stop());
  }, [store, access?.ok]);

  const today = dayKey(Date.now());
  const sorted = useMemo(() => [...notes].sort((a, b) => Number(a.status === 'seen') - Number(b.status === 'seen') || rank(b.level) - rank(a.level) || b.createdAt - a.createdAt), [notes]);
  const open = sorted.find(note => note.id === openId) ?? null;
  const found = useMemo(() => clusters(signals, today).filter(cluster => cluster.thisWeek > 0), [signals, today]);
  const trained = useMemo(() => readiness(training, today), [training, today]);
  const sample = signals.some(signal => signal.key.startsWith('sample-')) || training.some(item => item.key.startsWith('sample-'));
  const most = Math.max(1, ...Object.values(trained));
  const setLang = (value: 'en' | 'fr') => personal.set(current => ({ profile: { ...current.profile, lang: value } }));

  return (
    <div className="clinic">
      <header className="clinic-bar">
        <IconButton icon="arrow_back" label={t('clinic.backToApp')} onClick={() => go('/')} />
        <div className="clinic-name">
          <h1>{t('clinic.title')}</h1>
          <p>{t('clinic.station')}</p>
        </div>
        <Pill tone="primary" icon={store?.mode === 'firestore' ? 'cloud_done' : 'memory'}>{t(store?.mode === 'firestore' ? 'data.firestore' : 'data.device')}</Pill>
        <div className="chips">
          <Chip selected={lang === 'en'} onClick={() => setLang('en')}>EN</Chip>
          <Chip selected={lang === 'fr'} onClick={() => setLang('fr')}>FR</Chip>
        </div>
      </header>

      {access && !access.ok && (
        <Card tone="low" className="clinic-gate">
          <Row icon="lock" tone="primary" title={t(access.reason === 'not-listed' ? 'clinic.notListed' : 'clinic.signInTitle')} sub={access.reason === 'not-listed' ? t('clinic.notListedBody', { uid: access.uid ?? '' }) : t('clinic.signInBody')} />
          {access.reason !== 'not-listed' && <Button variant="filled" onClick={() => void store?.signIn?.().then(() => store.clinicAccess()).then(setAccess).catch(() => undefined)}>{t('clinic.signIn')}</Button>}
        </Card>
      )}
      {failed && <Card tone="error"><Row icon="error" title={t('clinic.failed')} /></Card>}

      {access?.ok && (
        <div className="clinic-grid">
          <section className="clinic-col" aria-label={t('clinic.notes')}>
            <h2 className="clinic-h">{t('clinic.notes')} <span className="count">{sorted.filter(note => note.status !== 'seen').length}</span></h2>
            {sorted.length === 0 && <p className="lead">{t('clinic.noNotes')}</p>}
            <ul className="note-list">
              {sorted.map(note => (
                <li key={note.id}>
                  <button type="button" className={`note-item ${note.id === openId ? 'on' : ''} ${note.status === 'seen' ? 'seen' : ''}`} data-level={note.level} onClick={() => setOpenId(note.id)}>
                    <span className={`note-mark mark-${LEVEL_TONE[note.level]}`}><Icon name={LEVEL_ICON[note.level]} fill size={20} /></span>
                    <span className="note-text">
                      <strong>{note.who}{note.age !== undefined && `, ${note.age}`}</strong>
                      <span>{note.reasons[0] ?? t(`level.${note.level}.short`)}</span>
                      <small>{note.area} · {timeAgo(note.createdAt, lang)}</small>
                    </span>
                    {note.status !== 'seen' && <i className="dot" aria-label={t('clinic.unread')} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="clinic-col clinic-detail" aria-label={t('clinic.detail')}>
            {!open && <p className="lead center">{t('clinic.pick')}</p>}
            {open && <NoteDetail note={open} onSeen={() => void store?.markSeen(open.id)} />}
          </section>

          <section className="clinic-col" aria-label={t('clinic.community')}>
            <h2 className="clinic-h">{t('clinic.community')} {sample && <Pill tone="soon" icon="info">{t('clinic.sample')}</Pill>}</h2>
            {found.length === 0 && <p className="lead">{t('clinic.noSignals')}</p>}
            {found.slice(0, 6).map(cluster => (
              <Card key={`${cluster.area}-${cluster.group}`} tone={cluster.flagged ? 'urgent' : 'low'} className="cluster" label={`${cluster.area} ${t(`group.${cluster.group}`)}`}>
                <div className="cluster-head">
                  <strong>{cluster.area} · {t(`group.${cluster.group}`)}</strong>
                  {cluster.flagged && <Pill tone="error" icon="warning">{t('clinic.cluster')}</Pill>}
                </div>
                <p>{t('clinic.households', { n: cluster.thisWeek, usual: cluster.earlier })}</p>
                <div className="bars" role="img" aria-label={t('clinic.barsLabel', { values: cluster.daily.join(', ') })}>
                  {cluster.daily.map((value, i) => <i key={i} style={{ height: `${Math.max(6, (value / Math.max(1, ...cluster.daily)) * 100)}%` }} className={value ? (i >= 7 ? 'now' : 'then') : 'zero'} />)}
                </div>
                <p className="fine">{t('clinic.barsCaption')}</p>
              </Card>
            ))}

            <h2 className="clinic-h">{t('clinic.readiness')}</h2>
            <Card tone="low" label={t('clinic.readiness')}>
              <p className="fine">{t('clinic.readinessBody')}</p>
              <ul className="hbars">
                {AREAS.map(area => (
                  <li key={area}>
                    <span>{area}</span>
                    <span className="hbar"><i style={{ width: `${((trained[area] ?? 0) / most) * 100}%` }} /></span>
                    <strong>{trained[area] ?? 0}</strong>
                  </li>
                ))}
              </ul>
            </Card>
            {store?.mode === 'demo' && (
              <div className="actions">
                <Button variant="tonal" onClick={() => (sample ? clearSample() : loadSample())}>{t(sample ? 'clinic.clearSample' : 'clinic.loadSample')}</Button>
              </div>
            )}
            <p className="fine">{t('clinic.privacy')}</p>
          </section>
        </div>
      )}
    </div>
  );
}

function NoteDetail({ note, onSeen }: { note: Note; onSeen: () => void }) {
  const { t, lang } = useT();
  const tone = LEVEL_TONE[note.level];
  return (
    <article className="note">
      <Card tone={tone} className="note-banner" label={t(`level.${note.level}.short`)}>
        <Icon name={LEVEL_ICON[note.level]} fill size={28} />
        <div>
          <h2>{note.who}{note.age !== undefined && `, ${note.age}`} · {note.area}</h2>
          <p>{t('clinic.protocol')}: <strong>{t(`level.${note.level}.short`)}</strong> · {new Date(note.createdAt).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
      </Card>

      <dl className="facts">
        <div><dt>{t('clinic.why')}</dt><dd>{note.reasons.join(' · ') || '—'}</dd></div>
        <div><dt>{t('clinic.signs')}</dt><dd>{note.signs.map(id => SIGN_BY_ID.get(id)?.label[lang] ?? id).join(' · ') || '—'}{note.days ? ` · ${t('clinic.days', { n: note.days })}` : ''}</dd></div>
        {note.words && <div><dt>{t('clinic.words')}</dt><dd className="quote">“{note.words}”</dd></div>}
        <div><dt>{t('clinic.measured')}</dt><dd>{[note.vitals.pulse ? t('check.pulseValue', { n: note.vitals.pulse }) : '', note.vitals.coughs !== undefined ? t('check.coughValue', { n: note.vitals.coughs, s: note.vitals.coughSeconds ?? 15 }) : '', note.hasPhoto ? t('clinic.photo') : ''].filter(Boolean).join(' · ') || '—'}</dd></div>
        <div><dt>{t('nav.medicine')}</dt><dd>{note.medicines.length ? <ul>{note.medicines.map(item => <li key={item}>{item}</li>)}</ul> : '—'}</dd></div>
        {note.flags.length > 0 && <div className="facts-flag"><dt>{t('clinic.flags')}</dt><dd><ul>{note.flags.map(item => <li key={item}>{item}</li>)}</ul></dd></div>}
        <div><dt>{t('settings.allergies')}</dt><dd>{note.allergies || '—'}</dd></div>
        <div><dt>{t('settings.conditions')}</dt><dd>{note.conditions || '—'}</dd></div>
      </dl>

      <Card tone="low" label={t('clinic.summary')}>
        <h3 className="card-title"><Icon name={note.summary ? 'auto_awesome' : 'verified_user'} fill size={18} /> {t(note.summary ? `note.by.${note.aiTier}` : 'clinic.noSummary')}</h3>
        {note.summary && <p>{note.summary}</p>}
        <p className="fine">{t('clinic.summaryNote')}</p>
      </Card>

      <div className="actions">
        {note.status === 'seen' ? <Pill tone="go" icon="check_circle">{t('note.seen')}</Pill> : <Button variant="filled" icon="check" onClick={onSeen}>{t('clinic.markSeen')}</Button>}
      </div>
    </article>
  );
}
