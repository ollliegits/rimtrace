import { AnalysisSession, defaultRealSetup, type RealResult, type RealSetup, type SessionStatus } from '../core';

export type ToWorker =
  | { t: 'config'; setup: RealSetup }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'frame'; data: ArrayBuffer; width: number; height: number };

export type FromWorker =
  | { t: 'ack' }
  | { t: 'status'; status: SessionStatus }
  | { t: 'result'; result: RealResult }
  | { t: 'error'; message: string };

let setup: RealSetup = defaultRealSetup;
let session: AnalysisSession | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

const post = (m: FromWorker) => postMessage(m);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.t === 'config') setup = m.setup;
    else if (m.t === 'start') {
      session = new AnalysisSession(setup);
      clearInterval(timer);
      timer = setInterval(() => session && post({ t: 'status', status: session.status() }), 500);
    } else if (m.t === 'stop') {
      clearInterval(timer);
      if (session) {
        post({ t: 'status', status: session.status() });
        post({ t: 'result', result: session.result() });
      }
      session = undefined;
    } else {
      session?.push({ data: new Uint8Array(m.data), width: m.width, height: m.height });
      post({ t: 'ack' });
    }
  } catch (err) {
    post({ t: 'error', message: (err as Error).message });
    if (m.t === 'frame') post({ t: 'ack' });
  }
};
