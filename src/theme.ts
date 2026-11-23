// Material 3 colour, generated at start-up from one seed with Google's colour library.
// Every colour on screen is a role from this scheme, so light and dark always agree.
import { argbFromHex, customColor, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';

const SEED = '#0B57D0';
/** Semantic colours, harmonised toward the seed so they sit well beside it. */
const SEMANTIC = { go: '#1E8E3E', soon: '#B06000', urgent: '#C5221F' } as const;

export type ThemeChoice = 'auto' | 'light' | 'dark';

const SURFACES = {
  light: { surface: 98, 'surface-dim': 87, 'surface-bright': 98, 'surface-lowest': 100, 'surface-low': 96, 'surface-container': 94, 'surface-high': 92, 'surface-highest': 90 },
  dark: { surface: 6, 'surface-dim': 6, 'surface-bright': 24, 'surface-lowest': 4, 'surface-low': 10, 'surface-container': 12, 'surface-high': 17, 'surface-highest': 22 },
} as const;

const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

export function applyTheme(choice: ThemeChoice): 'light' | 'dark' {
  const dark = choice === 'dark' || (choice === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mode = dark ? 'dark' : 'light';
  const source = argbFromHex(SEED);
  const theme = themeFromSourceColor(source);
  const scheme = theme.schemes[mode].toJSON() as Record<string, number>;
  const style = document.documentElement.style;
  for (const [name, argb] of Object.entries(scheme)) style.setProperty(`--${kebab(name)}`, hexFromArgb(argb));
  for (const [name, tone] of Object.entries(SURFACES[mode])) style.setProperty(`--${name}`, hexFromArgb(theme.palettes.neutral.tone(tone)));
  for (const [name, hex] of Object.entries(SEMANTIC)) {
    const group = customColor(source, { name, value: argbFromHex(hex), blend: true })[mode];
    style.setProperty(`--${name}`, hexFromArgb(group.color));
    style.setProperty(`--on-${name}`, hexFromArgb(group.onColor));
    style.setProperty(`--${name}-container`, hexFromArgb(group.colorContainer));
    style.setProperty(`--on-${name}-container`, hexFromArgb(group.onColorContainer));
  }
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hexFromArgb(theme.palettes.neutral.tone(SURFACES[mode].surface)));
  return mode;
}
