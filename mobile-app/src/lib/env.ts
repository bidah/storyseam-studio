// Where the Shot Studio Worker lives. Override with EXPO_PUBLIC_API_URL in .env
// for local dev (e.g. http://192.168.x.x:3334 when running `npm run worker:dev`).
export const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL ||
  'https://shot-studio-uploads.rodrigofigueroa-name.workers.dev'
).replace(/\/$/, '');
