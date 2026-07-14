import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// The active project. Every API request carries it as x-project-id (fetch shim)
// and every media URL as ?projectId= (api.ts). Mirrors the web app's
// projectFetch.js store, persisted in AsyncStorage.

const STORAGE_KEY = 'shot-studio:projectId';

type ProjectState = {
  projectId: string | null;
  hydrated: boolean;
  setProjectId: (id: string | null) => void;
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectId: null,
  hydrated: false,
  setProjectId: (id) => {
    if (id === get().projectId) return;
    set({ projectId: id });
    if (id) AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));

// Synchronous getter for non-React callers (fetch shim, media URLs).
export function getProjectId(): string | null {
  return useProjectStore.getState().projectId;
}

export function setProjectId(id: string | null) {
  useProjectStore.getState().setProjectId(id);
}

let hydration: Promise<void> | null = null;
export function hydrateProjectId(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        useProjectStore.setState({ projectId: v || null, hydrated: true });
      })
      .catch(() => {
        useProjectStore.setState({ hydrated: true });
      });
  }
  return hydration;
}
