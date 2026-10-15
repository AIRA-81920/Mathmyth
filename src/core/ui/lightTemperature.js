export function normalizeLightTemperature(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 45;
}

export function lightPalette(value) {
  const amount = normalizeLightTemperature(value) / 100;
  const mix = (cool, warm) => cool.map((channel, i) => Math.round(channel + (warm[i] - channel) * amount));
  const surface = mix([250,250,250], [248,240,223]);
  const muted = mix([239,239,239], [236,226,205]);
  const elevated = mix([255,255,255], [255,249,235]);
  return { surface: `rgb(${surface.join(' ')})`, muted: `rgb(${muted.join(' ')})`,
    elevated: `rgb(${elevated.join(' ')})`, input: `rgb(${surface.join(' ')} / 82%)` };
}

export function applyLightTemperature(value, root = globalThis.document?.documentElement) {
  if (!root) return;
  const colors = lightPalette(value);
  for (const [name, color] of Object.entries(colors)) root.style.setProperty(`--light-${name}`, color);
}
