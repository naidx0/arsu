import { checkMedicines, titleCase } from '../core/meds';
import { reasonText } from '../core/note';
import { personal, todayKey, usePersonal } from '../store/personal';
import { go, timeAgo, useNoteStatus, useOnline, useShared, useT, useTier } from '../ui/hooks';
import { Button, Card, Icon, IconButton, Pill, Row } from '../ui/kit';
import { LEVEL_ICON } from './Check';

export function Today({ onSettings }: { onSettings: () => void }) {
  const { t, lang } = useT();
  const state = usePersonal();
  const online = useOnline();
  const tier = useTier();
  const store = useShared();
  const status = useNoteStatus(state.ownerId);
  const findings = checkMedicines(state.medicines);
  const today = todayKey();
  const taken = state.doses[today] ?? {};
  const doses = state.medicines.flatMap(medicine => medicine.times.map(time => ({ key: `${medicine.id}@${time}`, time, name: titleCase(medicine.brand) }))).sort((a, b) => a.time.localeCompare(b.time));
  const lastPractice = state.practice.find(item => item.skill === 'cpr');
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening');
  const toggle = (key: string) => personal.set(current => ({ doses: { ...current.doses, [today]: { ...(current.doses[today] ?? {}), [key]: !taken[key] } } }));

  return (
    <div className="screen">
      <header className="hello">
        <div>
          <p className="hello-brand"><Icon name="favorite" fill size={18} /> Kin</p>
          <h1>{state.profile.name ? `${greeting}, ${state.profile.name}` : greeting}</h1>
        </div>
        <IconButton icon="person" label={t('settings.title')} tonal onClick={onSettings} />
      </header>

      <div className={`signal ${online ? 'signal-on' : 'signal-off'}`} role="status">
        <Icon name={online ? 'cloud_done' : 'wifi_off'} fill size={20} />
        <span>{t(online ? 'today.online' : 'today.offline')}</span>
      </div>

      <Card tone="primary" className="hero">
        <h2>{t('today.howFeeling')}</h2>
        <p>{t('today.checkBody')}</p>
        <Button variant="filled" icon="stethoscope" large onClick={() => go('/check')}>{t('today.startCheck')}</Button>
      </Card>

      <Card tone="low" onClick={() => go('/medicine')} label={t('nav.medicine')}>
        <Row icon="medication" tone={findings.some(item => item.severity === 'high') ? 'error' : 'primary'}
          title={state.medicines.length ? t('today.medCount', { n: state.medicines.length }) : t('today.addMeds')}
          sub={!state.medicines.length ? t('today.addMedsBody') : findings.length ? t('today.medFlags', { n: findings.length }) : t('today.medNoFlags')}
          end={<Icon name="chevron_right" />} />
      </Card>

      {doses.length > 0 && (
        <Card tone="low" label={t('today.doses')}>
          <h3 className="card-title">{t('today.doses')}</h3>
          <ul className="doses">
            {doses.map(dose => (
              <li key={dose.key}>
                <label className="dose">
                  <input type="checkbox" checked={Boolean(taken[dose.key])} onChange={() => toggle(dose.key)} />
                  <span className="dose-time">{dose.time}</span>
                  <span className="dose-name">{dose.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card tone="low" onClick={() => go('/ready')} label={t('nav.ready')}>
        <Row icon="health_and_safety" tone="go" title={t('today.ready')}
          sub={lastPractice ? t('today.lastPractice', { score: lastPractice.inTarget, when: timeAgo(lastPractice.at, lang) }) : t('today.neverPractised')}
          end={<Icon name="chevron_right" />} />
      </Card>

      {state.notes.length > 0 && (
        <Card tone="low" label={t('today.notes')}>
          <h3 className="card-title">{t('today.notes')}</h3>
          {state.notes.slice(0, 4).map(note => {
            const waiting = status.pending.has(note.id), seen = status.seen.has(note.id);
            return (
              <Row key={note.id} icon={LEVEL_ICON[note.level]} tone={note.level === 'emergency' || note.level === 'urgent' ? 'error' : note.level === 'soon' ? 'soon' : 'go'}
                title={note.reasons[0] ?? (note.signs[0] ? reasonText({ sign: note.signs[0], rule: 'sign' }, lang) : t(`level.${note.level}`))}
                sub={timeAgo(note.createdAt, lang)}
                end={<Pill tone={waiting ? 'soon' : seen ? 'go' : 'primary'} icon={waiting ? 'schedule' : seen ? 'done_all' : 'check'}>{t(waiting ? 'note.waiting' : seen ? 'note.seen' : 'note.sent')}</Pill>} />
            );
          })}
        </Card>
      )}

      <p className="fine">
        <Icon name={tier === 'rules' ? 'verified_user' : 'auto_awesome'} size={16} fill /> {t(`tier.${tier}`)} · {t(store?.mode === 'firestore' ? 'data.firestore' : 'data.device')}
      </p>
    </div>
  );
}
