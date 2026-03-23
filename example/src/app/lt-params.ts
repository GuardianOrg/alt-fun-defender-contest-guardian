import type { Asset } from "../constants/targetAssets";

interface LTParams {
  LDF: number;
  SCBTA: number;
  SCBDF: number;
}

const LT_PARAMS: Record<string, Record<string, LTParams>> = {
  BTC: {
    "2x": {
      LDF: 0.1,
      SCBTA: 0.48,
      SCBDF: 0.5,
    },
    "3x": {
      LDF: 0.15,
      SCBTA: 0.38,
      SCBDF: 0.5,
    },
    "5x": {
      LDF: 0.25,
      SCBTA: 0.24,
      SCBDF: 0.5,
    },
  },
  ETH: {
    "2x": {
      LDF: 0.12,
      SCBTA: 0.48,
      SCBDF: 0.5,
    },
    "3x": {
      LDF: 0.18,
      SCBTA: 0.36,
      SCBDF: 0.5,
    },
    "5x": {
      LDF: 0.3,
      SCBTA: 0.22,
      SCBDF: 0.5,
    },
  },
  SOL: {
    "2x": {
      LDF: 0.12,
      SCBTA: 0.48,
      SCBDF: 0.5,
    },
    "3x": {
      LDF: 0.18,
      SCBTA: 0.36,
      SCBDF: 0.5,
    },
    "5x": {
      LDF: 0.3,
      SCBTA: 0.22,
      SCBDF: 0.5,
    },
  },
  HYPE: {
    "2x": {
      LDF: 0.12,
      SCBTA: 0.48,
      SCBDF: 0.5,
    },
    "3x": {
      LDF: 0.18,
      SCBTA: 0.36,
      SCBDF: 0.5,
    },
    "5x": {
      LDF: 0.3,
      SCBTA: 0.22,
      SCBDF: 0.5,
    },
  },
  PAXG: {
    "2x": {
      LDF: 0.06,
      SCBTA: 0.5,
      SCBDF: 0.5,
    },
    "3x": {
      LDF: 0.09,
      SCBTA: 0.4,
      SCBDF: 0.5,
    },
    "5x": {
      LDF: 0.15,
      SCBTA: 0.22,
      SCBDF: 0.5,
    },
  },
};

export default LT_PARAMS;

export const getLtParams = (asset: Asset, leverage: number) => {
  const leverageString = `${leverage}x`;
  const assetData = LT_PARAMS[asset];
  if (!assetData) throw new Error(`No asset data for ${asset}`);
  const params = assetData[leverageString];
  if (!params) throw new Error(`No LT params for ${asset} ${leverageString}`);
  return params;
};
