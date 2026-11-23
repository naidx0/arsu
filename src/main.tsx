import '@fontsource-variable/google-sans-flex/wght.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { personal } from './store/personal';
import './styles.css';
import { applyTheme } from './theme';

applyTheme(personal.get().theme);
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
