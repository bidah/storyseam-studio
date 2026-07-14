// Concrete hex values for the dark theme tokens (global.css), needed by things
// that can't take NativeWind classes: lucide icon `color` props and the native
// markdown renderer's style object.

export const chatColors = {
  background: '#0a0a0b',
  card: '#111113',
  foreground: '#fafafa',
  muted: '#27272a',
  mutedForeground: '#a1a1aa',
  border: '#27272a',
  primary: '#10b981',
  primaryForeground: '#ecfdf5',
  destructive: '#dc2626',
  amber: '#f59e0b',
} as const;
