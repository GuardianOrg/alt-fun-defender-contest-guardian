import round from "./round";
import { getLtParams } from "../app/lt-params";

import type { Asset } from "../constants/targetAssets";

export const getLeverageRange = (
  targetAsset: Asset,
  targetLeverage: number,
  isLong: boolean,
): string => {
  const leverageDeviationFactor = getLtParams(targetAsset, targetLeverage).LDF;

  const lower =
    (targetLeverage + (isLong ? 1 : -1) * leverageDeviationFactor) /
    (1 + leverageDeviationFactor);

  const upper =
    (targetLeverage + (isLong ? -1 : 1) * leverageDeviationFactor) /
    (1 - leverageDeviationFactor);

  const lowerRange = round(lower, 2);
  const upperRange = round(upper, 2);

  return `${lowerRange} - ${upperRange}x`;
};
