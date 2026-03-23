import { useSelector } from "react-redux";

import useAllUserTrades from "./Indexer/useTrades";
import { selectSelectedTargetAsset } from "../state/mintSlice";

export const useLiveTrades = () => {
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);

  const { data } = useAllUserTrades({
    targetAsset: selectedTargetAsset.symbol,
  });
  const trades = data?.items;
  return trades;
};
