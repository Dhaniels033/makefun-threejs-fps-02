// The look plan, in one place. Six base values and one accent hue; the lighting
// makes every shade the game needs. Two team colours (ember = attackers, teal =
// defenders) are the only additions, used for site markings and bot uniforms.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  ember: '#e05a2a',
  teal: '#2aa8a0',
};

export function shade(name) {
  return PALETTE[name];
}
