// One deterministic chord straddles each boundary of the Demo's four-way render.
const sampleRate = 24_000;
const samples = sampleRate * 3;

export function demoToneBytes() {
  const data = new Uint8Array(44 + 2 * samples);
  const view = new DataView(data.buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) data[offset + i] = value.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, data.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = [23 / 30, 46 / 30, 68 / 30].reduce((sum, center) => {
      const d = (t - center) / 0.20;
      return sum + (Math.abs(d) < 1 ? (1 + Math.cos(Math.PI * d)) / 2 : 0);
    }, 0);
    const signal = Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 660 * t);
    view.setInt16(44 + i * 2, Math.round(9_000 * envelope * signal), true);
  }
  return data;
}

export const demoTone = () => {
  const data = demoToneBytes();
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
};
