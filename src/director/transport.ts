import { createFalClient } from '@fal-ai/client';
import { wma } from '@fal-ai/client/realtime/wma';
import type { Transport, TransportFactory } from './session';

// The Stage's end of a Director Session.
//
// The third implementation of the same three methods — `send`, `close`, and an
// event callback — after the device's (`fal-transport.ts`) and Admin's
// (`web-transport.ts`). The state machine underneath is shared and imports
// none of them, which is exactly what it was written against an interface for.
//
// The proxy is a relative path and always will be: the page and the Worker are
// the same origin here by construction. What the proxy adds on the far side is
// the fal key — pinned to this one endpoint and its three session routes,
// because a proxy that forwards anywhere is a fal key with extra steps.

export const DIRECTOR_ENDPOINT = 'minimax/h3-max/director';

/**
 * A client per credential rather than the shared `fal` singleton.
 *
 * `fal.config()` is global. Admin's transport works around that with a
 * `configuredFor` guard; a fresh client per token has the same effect without
 * the module-level variable, and means nothing this file does can change the
 * configuration of a client somebody else is holding.
 */
function clientFor(falKey: string | null) {
  return createFalClient({
    proxyUrl: '/api/stage/fal/proxy',
    // BYOK, like every other generation in this studio: the author's own fal
    // key rides each request and is never persisted server-side. The proxy
    // falls back to the operator's `FAL_KEY` in development, so sending
    // nothing is a valid state rather than an error.
    //
    // `projectFetch` cannot do this for us — the fal client builds its own
    // requests — so the key is stamped here, on the one path that needs it.
    requestMiddleware: async (request) =>
      falKey
        ? { ...request, headers: { ...request.headers, 'x-fal-key': falKey } }
        : request,
  });
}

export function stageTransport(falKey: string | null, endpointId = DIRECTOR_ENDPOINT): TransportFactory {
  return (emit) => {
    const fal = clientFor(falKey);

    const handle = fal.realtime.open(wma(endpointId), {
      // Declared before the offer is created: a WebRTC answer cannot introduce
      // a media section the offer did not have.
      receive: ['video', 'audio'],
      onState: (state) => emit({ type: 'state', state }),
      onData: (raw) => emit({ type: 'data', raw }),
      onError: (error) => emit({ type: 'error', error }),
      // The client's richest failure channel, and the reason a misconfigured
      // proxy says so instead of "the stream stopped unexpectedly".
      onDiagnostic: (d) => {
        if (d.kind === 'failure') {
          emit({ type: 'diagnostic', failure: d.message, observed: d.observed });
        }
      },
      onMedia: (stream) => {
        emit({ type: 'media', stream });
        const [video] = stream.getVideoTracks();
        video?.addEventListener?.('unmute', () => emit({ type: 'frame' }));
      },
    });

    const transport: Transport = {
      send: (message) => handle.send(message),
      close: () => handle.close(),
    };
    return transport;
  };
}

/**
 * The `MediaStream` itself, which is what a `<video>` element's srcObject takes
 * and what `MediaRecorder` records.
 *
 * The session's `stream` is typed `unknown` on purpose — the machine has no
 * opinion about what a platform's media object is — so this is where the Stage
 * asserts that on this one it is the DOM's.
 */
export function asMediaStream(stream: unknown): MediaStream | null {
  return typeof MediaStream !== 'undefined' && stream instanceof MediaStream ? stream : null;
}
