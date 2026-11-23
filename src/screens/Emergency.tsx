import { useEffect, useState } from 'react';
import { titleCase } from '../core/meds';
import { SCRIPTS } from '../data/scripts';
import { locate, type Place } from '../sensors';
import { usePersonal } from '../store/personal';
import { back, go, isDemoRun, useT } from '../ui/hooks';
import { Button, Card, Icon, IconButton, Row } from '../ui/kit';

/** One screen for the worst day: the call, where you are, the steps, and who you are. */
export function Emergency() {
  const { t, lang } = useT();
  const state = usePersonal();
  const [place, setPlace] = useState<Place | null | 'looking'>('looking');
  useEffect(() => { let live = true; void locate().then(found => { if (live) setPlace(found); }); return () => { live = false; }; }, []);
  const age = state.profile.birthYear ? new Date().getFullYear() - state.profile.birthYear : null;
  const demo = isDemoRun();

  return (
    <div className="screen screen-sos">
      <header className="sos-head">
        <IconButton icon="close" label={t('common.close')} onClick={() => back('/')} />
        <h1>{t('sos.title')}</h1>
      </header>

      {demo
        ? <Button variant="danger" large block icon="call" className="sos-call" onClick={() => alert(t('sos.demoCall'))}>{t('sos.call')}</Button>
        : <a className="btn btn-danger btn-large btn-block sos-call" href="tel:911"><Icon name="call" fill size={28} /><span>{t('sos.call')}</span></a>}
      <p className="sos-first">{t('sos.first')}</p>

      <Card tone="high" label={t('sos.where')}>
        <Row icon="location_on" tone="error" title={t('sos.where')}
          sub={place === 'looking' ? t('sos.locating') : place ? <><span className="coords">{place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}</span><br />{t('sos.accuracy', { n: Math.round(place.accuracy) })} · {state.profile.area}</> : <>{t('sos.noLocation')} · {state.profile.area}</>} />
        <p className="fine">{t('sos.readOut')}</p>
      </Card>

      <h2 className="group-title">{t('sos.steps')}</h2>
      <div className="sos-grid">
        {SCRIPTS.map(script => (
          <button key={script.skill} type="button" className="sos-tile" onClick={() => go(`/ready/${script.skill}?live`)}>
            <Icon name={script.icon} fill size={28} />
            <span>{script.name[lang]}</span>
          </button>
        ))}
      </div>

      <Card tone="high" label={t('sos.summary')}>
        <h2 className="card-title">{t('sos.summary')}</h2>
        <dl className="facts">
          <div><dt>{t('settings.name')}</dt><dd>{state.profile.name || '—'}{age !== null && `, ${age}`}</dd></div>
          <div><dt>{t('settings.allergies')}</dt><dd>{state.profile.allergies || '—'}</dd></div>
          <div><dt>{t('settings.conditions')}</dt><dd>{state.profile.conditions || '—'}</dd></div>
          <div><dt>{t('nav.medicine')}</dt><dd>{state.medicines.length ? state.medicines.map(medicine => titleCase(medicine.brand)).join(', ') : '—'}</dd></div>
          <div><dt>{t('settings.contact')}</dt><dd>{state.profile.contact || '—'}</dd></div>
        </dl>
      </Card>
      <p className="fine center">{t('sos.note')}</p>
    </div>
  );
}
