import { Fragment, useEffect, useState } from 'react';
import type { Skill } from './data/scripts';
import { SCRIPT_BY_SKILL } from './data/scripts';
import { Check } from './screens/Check';
import { Clinic } from './screens/Clinic';
import { Emergency } from './screens/Emergency';
import { Medicine } from './screens/Medicine';
import { Coach, Ready } from './screens/Ready';
import { Settings, Welcome } from './screens/Settings';
import { Today } from './screens/Today';
import { usePersonal } from './store/personal';
import { applyTheme } from './theme';
import { go, useRoute, useT } from './ui/hooks';
import { Icon } from './ui/kit';

const TABS = [
  { path: '/', icon: 'home', key: 'nav.today' },
  { path: '/check', icon: 'stethoscope', key: 'nav.check' },
  { path: '/medicine', icon: 'medication', key: 'nav.medicine' },
  { path: '/ready', icon: 'health_and_safety', key: 'nav.ready' },
];

export function App() {
  const route = useRoute();
  const { t, lang } = useT();
  const state = usePersonal();
  const [settings, setSettings] = useState(false);
  const [path, query = ''] = route.split('?');

  useEffect(() => {
    applyTheme(state.theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(state.theme);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [state.theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  if (path === '/clinic') return <Clinic />;
  if (path === '/emergency') return <div className="app"><main><Emergency /></main></div>;

  const skill = path.startsWith('/ready/') ? (path.slice(7) as Skill) : null;
  const coach = skill && SCRIPT_BY_SKILL.has(skill);
  const tab = coach ? '/ready' : TABS.some(item => item.path === path) ? path : '/';
  const live = new URLSearchParams(query).has('live');

  return (
    <div className="app">
      <main>
        {coach ? <Coach key={skill} skill={skill} live={live} />
          : tab === '/check' ? <Check />
          : tab === '/medicine' ? <Medicine />
          : tab === '/ready' ? <Ready />
          : <Today onSettings={() => setSettings(true)} />}
      </main>

      {!live && (
        <nav className="nav" aria-label={t('nav.label')}>
          {TABS.map((item, index) => (
            <Fragment key={item.path}>
              {/* Emergency sits in the middle of the bar: one thumb away on every screen, covering nothing. */}
              {index === 2 && (
                <button type="button" className="nav-sos" onClick={() => go('/emergency')} aria-label={t('sos.open')}>
                  <span className="nav-pill"><Icon name="emergency" fill /></span>
                  <span className="nav-label">{t('sos.short')}</span>
                </button>
              )}
              <button type="button" className={item.path === tab ? 'on' : ''} aria-current={item.path === tab ? 'page' : undefined} onClick={() => go(item.path)}>
                <span className="nav-pill"><Icon name={item.icon} fill={item.path === tab} /></span>
                <span className="nav-label">{t(item.key)}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      )}

      <Settings open={settings} onClose={() => setSettings(false)} />
      <Welcome />
    </div>
  );
}
