import { create } from 'zustand';
import type { TokenFilter } from '@/services/types';

interface UIState {
  searchOpen: boolean;
  earningsOpen: boolean;
  activeFilter: TokenFilter;
  setSearchOpen: (open: boolean) => void;
  setEarningsOpen: (open: boolean) => void;
  setActiveFilter: (filter: TokenFilter) => void;
}

export const useUIStore = create<UIState>((set) => ({
  searchOpen: false,
  earningsOpen: false,
  activeFilter: 'trending',
  setSearchOpen: (open) => set({ searchOpen: open }),
  setEarningsOpen: (open) => set({ earningsOpen: open }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
}));
