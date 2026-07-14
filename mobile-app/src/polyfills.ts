// Streaming + structured-data polyfills for native (Hermes). Must be imported
// before anything else (see index.js). The eve SDK and AI-style NDJSON streams
// need TextEncoder/DecoderStream; structuredClone is missing on Hermes.
import { Platform } from 'react-native';
import structuredClone from '@ungap/structured-clone';

if (Platform.OS !== 'web') {
  const g = globalThis as any;
  const setupPolyfills = async () => {
    const { TextEncoderStream, TextDecoderStream } = await import(
      '@stardazed/streams-text-encoding'
    );
    if (!g.structuredClone) g.structuredClone = structuredClone;
    if (!g.TextEncoderStream) g.TextEncoderStream = TextEncoderStream;
    if (!g.TextDecoderStream) g.TextDecoderStream = TextDecoderStream;
  };
  setupPolyfills();
}

export {};
