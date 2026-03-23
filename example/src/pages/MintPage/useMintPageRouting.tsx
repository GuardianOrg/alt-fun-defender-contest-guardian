/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";

import { TARGET_ASSETS, type Asset } from "../../constants/targetAssets";
import {
  selectSelectedTargetAsset,
  setSelectedPosition,
  setSelectedTargetAsset,
  type SetSelectedPositionPayload,
} from "../../state/mintSlice";

export const useSyncTokenFromURL = () => {
  const { targetAssetParam } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);

  const validTokens = TARGET_ASSETS.map((asset) => asset.symbol);

  useEffect(() => {
    if (!targetAssetParam) return;

    const tokenUpper = targetAssetParam.toUpperCase();

    // redirect if invalid
    if (!validTokens.includes(tokenUpper as Asset)) {
      navigate("/mint/" + selectedTargetAsset.symbol.toUpperCase(), {
        replace: true,
      });
      return;
    }

    // sync only if different from current
    if (selectedTargetAsset?.symbol !== tokenUpper) {
      dispatch(
        setSelectedTargetAsset(
          TARGET_ASSETS.find((asset) => asset.symbol === tokenUpper)!,
        ),
      );
    }
  }, [targetAssetParam]);
};

export const useSelectPositionAndNavigate = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  return (asset: SetSelectedPositionPayload) => {
    dispatch(setSelectedPosition(asset));
    navigate(`/mint/${asset.targetAsset.toUpperCase()}`);
  };
};
