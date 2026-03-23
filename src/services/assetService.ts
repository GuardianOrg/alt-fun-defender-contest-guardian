import {
  MOCK_ASSETS,
  MOCK_PLATFORM_STATS,
  MOCK_PAIR_FILTERS,
} from "./mock/assets";

import type { Asset, PlatformStats, PairFilter } from "./types";

export interface IAssetService {
  getAssets(): Promise<Asset[]>;
  getPlatformStats(): Promise<PlatformStats>;
  getPairFilters(): Promise<PairFilter[]>;
}

const mockAssetService: IAssetService = {
  async getAssets() {
    return [...MOCK_ASSETS];
  },

  async getPlatformStats() {
    return { ...MOCK_PLATFORM_STATS };
  },

  async getPairFilters() {
    return [...MOCK_PAIR_FILTERS];
  },
};

export const assetService: IAssetService = mockAssetService;
