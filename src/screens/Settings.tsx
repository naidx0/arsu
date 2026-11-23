import { useEffect, useState } from 'react';
import { deviceState, downloadDeviceModel, type DeviceState } from '../ai/brain';
import type { Lang } from '../data/protocol';
import { personal, usePersonal } from '../store/personal';
import { firebaseReady } from '../store/shared';
import type { ThemeChoice } from '../theme';
import { go, useOnline, useT } from '../ui/hooks';
import { Button, Chip, Field, Icon, Row, Sheet } from '../ui/kit';

export const AREAS = ['East Side', 'Lakeshore', 'Hilltop', 'Old Town', 'North Road'];

function LanguagePicker() {
  const lang = usePersonal().profile.lang;
  const set = (value: Lang) => personal.set(current => ({ profile: { ...current.profile, lang: value } }));
  return (
    <div className="chips" role="group" aria-label="Language / Langue">
      <Chip selected={lang === 'en'} onClick={() => set('en')}>English</Chip>
      <Chip selected={lang === 'fr'} onClick={() => set('fr')}>Français</Chip>
    </div>
  );
}

function AreaPicker() {
  const { t } = useT();
  const area = usePersonal().profile.area;
  return (
    <label className="field">
      <span className="field-label">{t('settings.area')}</span>
      <select value={area} onChange={event => personal.set(current => ({ profile: { ...current.profile, area: event.target.value } }))}>
        {AREAS.map(name => <option key={name}>{name}</option>)}
      </select>
    </label>
  );
}

/** First run: language, where you live, and what Kin is not. */
export function Welcome() {
  const { t } = useT();
  const state = usePersonal();
  return (
    <Sheet open={!state.welcomed} onClose={() => personal.set({ welcomed: true })} title={t('welcome.title')}>
      <p className="lead">{t('welcome.body')}</p>
      <LanguagePicker />
      <AreaPicker />
      <ul className="promises">
        <li><Icon name="verified_user" fill size={20} /> {t('welcome.notDoctor')}</li>
        <li><Icon name="wifi_off" fill size={20} /> {t('welcome.offline')}</li>
        <li><Icon name="lock" fill size={20} /> {t('welcome.private')}</li>
      </ul>
      <Button variant="filled" large block onClick={() => personal.set({ welcomed: true })}>{t('welcome.start')}</Button>
    </Sheet>
  );
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const state = usePersonal();
  const online = useOnline();
  const [device, setDevice] = useState<DeviceState>('unsupported');
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => { if (open) void deviceState().then(setDevice); }, [open]);
  const profile = (change: Partial<typeof state.profile>) => personal.set(current => ({ profile: { ...current.profile, ...change } }));
  const download = async () => {
    setProgress(0);
    const ok = await downloadDeviceModel(setProgress);
    setProgress(null);
    setDevice(ok ? 'ready' : await deviceState());
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('settings.title')}>
      <LanguagePicker />
      <Field label={t('settings.name')} value={state.profile.name} onChange={name => profile({ name })} />
      <Field label={t('settings.birthYear')} value={state.profile.birthYear ? String(state.profile.birthYear) : ''} inputMode="numeric" placeholder="1950"
        onChange={value => { const year = Number(value.replace(/\D/g, '').slice(0, 4)); profile({ birthYear: year >= 1900 && year <= new Date().getFullYear() ? year : undefined }); }} />
      <AreaPicker />
      <Field label={t('settings.allergies')} value={state.profile.allergies} onChange={allergies => profile({ allergies })} />
      <Field label={t('settings.conditions')} value={state.profile.conditions} onChange={conditions => profile({ conditions })} />
      <Field label={t('settings.contact')} value={state.profile.contact} onChange={contact => profile({ contact })} />

      <h3 className="group-title">{t('settings.look')}</h3>
      <div className="chips">
        {(['auto', 'light', 'dark'] as ThemeChoice[]).map(choice => <Chip key={choice} selected={state.theme === choice} icon={choice === 'dark' ? 'dark_mode' : choice === 'light' ? 'light_mode' : undefined} onClick={() => personal.set({ theme: choice })}>{t(`settings.theme.${choice}`)}</Chip>)}
      </div>

      <h3 className="group-title">{t('settings.how')}</h3>
      <Row icon="auto_awesome" tone="primary" title={t('settings.cloud')} sub={t(firebaseReady ? (online ? 'settings.cloudOn' : 'settings.cloudWaiting') : 'settings.cloudOff')} />
      <Row icon="memory" tone="primary" title={t('settings.device')} sub={t(`settings.device.${device}`)}
        end={device === 'downloadable' && progress === null ? <Button variant="tonal" onClick={download}>{t('settings.download')}</Button> : progress !== null ? `${Math.round(progress * 100)}%` : null} />
      <Row icon="verified_user" tone="go" title={t('settings.rules')} sub={t('settings.rulesBody')} />

      <label className="switch">
        <input type="checkbox" checked={state.share} onChange={event => personal.set({ share: event.target.checked })} />
        <span>{t('settings.share')}</span>
      </label>
      <p className="fine">{t('settings.shareBody')}</p>

      <div className="actions">
        <Button variant="outlined" icon="groups" onClick={() => { onClose(); go('/clinic'); }}>{t('settings.clinic')}</Button>
        <Button variant="text" icon="delete" onClick={() => { if (confirm(t('settings.eraseConfirm'))) { personal.reset(); onClose(); } }}>{t('settings.erase')}</Button>
      </div>
      <p className="fine">{t('settings.about')}</p>
    </Sheet>
  );
}
