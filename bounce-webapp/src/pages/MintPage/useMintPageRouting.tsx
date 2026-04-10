/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";

import {
  TARGET_ASSETS,
  getAvailableDirections,
} from "../../constants/targetAssets";
import {
  selectSelectedTargetAsset,
  selectLeverage,
  selectLongOrShort,
  setSelectedPosition,
  setSelectedTargetAsset,
  setLeverage,
  setLongOrShort,
  type SetSelectedPositionPayload,
} from "../../state/mintSlice";
import { getLeverageTokenSymbol } from "../../utils/getLeverageTokenSymbol.util";
import { parseLeveragedTokenParam } from "../../utils/parseLeveragedTokenParam.util";

export const useSyncTokenFromURL = () => {
  const { targetAssetParam } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const currentLeverage = useSelector(selectLeverage);
  const currentLongOrShort = useSelector(selectLongOrShort);

  useEffect(() => {
    if (!targetAssetParam) return;

    const parsed = parseLeveragedTokenParam(targetAssetParam);

    // redirect if invalid
    if (!parsed) {
      navigate("/mint/" + selectedTargetAsset.symbol.toUpperCase(), {
        replace: true,
      });
      return;
    }

    const targetAsset = TARGET_ASSETS.find(
      (asset) => asset.symbol === parsed.asset,
    )!;

    // Validate direction against available directions for this leverage
    if (parsed.leverage !== null && parsed.direction !== null) {
      const available = getAvailableDirections(targetAsset, parsed.leverage);
      if (!available.includes(parsed.direction)) {
        navigate(
          `/mint/${getLeverageTokenSymbol(parsed.asset, parsed.leverage, available[0])}`,
          { replace: true },
        );
        return;
      }
    }

    // sync asset if different from current
    if (selectedTargetAsset?.symbol !== parsed.asset) {
      dispatch(setSelectedTargetAsset(targetAsset));
    }

    // sync leverage and direction if specified in the URL and different from current
    if (parsed.leverage !== null && parsed.leverage !== currentLeverage) {
      dispatch(setLeverage(parsed.leverage));
    }
    if (parsed.direction !== null && parsed.direction !== currentLongOrShort) {
      dispatch(setLongOrShort(parsed.direction));
    }
  }, [targetAssetParam]);
};

export const useSelectPositionAndNavigate = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  return (asset: SetSelectedPositionPayload) => {
    dispatch(setSelectedPosition(asset));
    const longOrShort = asset.isLong ? "long" : "short";
    navigate(
      `/mint/${getLeverageTokenSymbol(asset.targetAsset.toUpperCase(), asset.targetLeverage, longOrShort)}`,
    );
  };
};
