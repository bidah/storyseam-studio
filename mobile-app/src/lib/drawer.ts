import { create } from 'zustand';

// Global open/close state for the left navigation drawer (burger menu). No
// persistence — it's ephemeral UI state. Mirrors the small-store shape of
// project.ts so non-React callers (native header bar-button onPress, which runs
// outside a component) can toggle it too.

type DrawerState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openDrawer() {
  useDrawerStore.getState().setOpen(true);
}

export function closeDrawer() {
  useDrawerStore.getState().setOpen(false);
}
