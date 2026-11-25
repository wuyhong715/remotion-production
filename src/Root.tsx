import {AbsoluteFill, Audio, Composition, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {demoTone} from './tone';

let tone: string | undefined;

function Scene({audio, dense}: {audio: boolean; dense: boolean}) {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();
  const scale = width / 640;
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1]);
  const accent = ['#78e9d5', '#ffd283', '#adabff'][Math.floor(progress * 2.999)];
  const x = interpolate(progress, [0, 1], [52, 588]) * scale;

  return (
    <AbsoluteFill style={{background: 'radial-gradient(ellipse at 75% 30%, #273c57, #101928 68%)', color: '#f5f7fb', fontFamily: 'monospace'}}>
      {audio && <Audio src={tone ??= demoTone()} />}
      <svg width={width} height={height} aria-hidden="true" style={{position: 'absolute', left: 0, top: 0}}>
        <g transform={`scale(${scale})`}>
          {Array.from({length: dense ? 600 : 44}, (_, i) => {
            const angle = i * 2.39996 + frame * (0.009 + i % 7 * 0.0008);
            const r = 12 + (i * 31 % 137);
            const cx = 445 + (r * 1.08) * Math.cos(angle);
            const cy = 175 + r * Math.sin(angle);
            return i % 7 === 0
              ? <line key={i} x1={445} y1={175} x2={cx} y2={cy} stroke={accent} strokeOpacity={0.12} />
              : <circle key={i} cx={cx} cy={cy} r={1 + i % 6 * 0.28} fill={accent} opacity={0.25 + i % 9 * 0.065} />;
          })}
        </g>
      </svg>
      <div style={{position: 'absolute', left: 52 * scale, top: 121 * scale}}>
        <div style={{fontSize: 12 * scale, letterSpacing: '0.18em', color: accent}}>REMOTION PRODUCTION</div>
        <div style={{fontSize: 39 * scale, fontWeight: 700, marginTop: 9 * scale}}>Frames in parallel</div>
        <div style={{fontSize: 19 * scale, marginTop: 10 * scale}}>Frame {String(frame).padStart(4, '0')}</div>
      </div>
      <div style={{position: 'absolute', left: 52 * scale, right: 52 * scale, top: 302 * scale, height: 2 * scale, backgroundColor: '#52647a'}} />
      <div style={{position: 'absolute', left: x - 4 * scale, top: 299 * scale, width: 8 * scale, height: 8 * scale, borderRadius: '50%', backgroundColor: accent}} />
    </AbsoluteFill>
  );
}

const Demo = () => <Scene audio dense={false} />;
const Silent = () => <Scene audio={false} dense={false} />;
const Benchmark = () => <Scene audio dense />;

export function Root() {
  return (
    <>
      <Composition id="Demo" component={Demo} durationInFrames={90} fps={30} width={640} height={360} />
      <Composition id="Silent" component={Silent} durationInFrames={26} fps={25} width={640} height={360} />
      <Composition id="Benchmark" component={Benchmark} durationInFrames={900} fps={30} width={1920} height={1080} />
    </>
  );
}
