import { computeSabByteLength, createSabViews, type SabViews } from '@traffic-lens/shared';

export interface SimSab {
  readonly sab: SharedArrayBuffer;
  readonly views: SabViews;
}

export function allocateSimSab(): SimSab {
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      'SharedArrayBuffer is unavailable — page must be served with ' +
      'COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, ' +
      'Cross-Origin-Embedder-Policy: require-corp).',
    );
  }
  const sab = new SharedArrayBuffer(computeSabByteLength());
  const views = createSabViews(sab);
  return { sab, views };
}
