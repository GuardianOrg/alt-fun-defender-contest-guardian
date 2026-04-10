import { useEffect } from "react";

import { useDispatch, useSelector } from "react-redux";

import { trackEvent } from "../../analytics/ga";
import {
  selectRedeemModalStage,
  setMintedAmountBigInt,
  setRecievedBaseAmount,
  setRecievedPnl,
  setRedeemModalStage,
  setTransactionProcessing,
} from "../../state/mintSlice";
import { setToast } from "../../state/toastSlice";
import {
  removePendingTrade,
  selectPendingTrades,
} from "../../state/transactionsSlice";
import { bigIntToNumber } from "../../utils/bigIntToNumber.util";

import type { AppDispatch } from "../../state/store";

export const useWatchTradesByTxHash = () => {
  const dispatch = useDispatch<AppDispatch>();
  const pendingTrades = useSelector(selectPendingTrades);
  const redeemModalStage = useSelector(selectRedeemModalStage);

  useEffect(() => {
    const txHashes = Object.keys(pendingTrades);
    if (txHashes.length === 0) return;

    let cancelled = false;

    const poll = async () => {
      await Promise.all(
        txHashes.map(async (txHash) => {
          const res = await fetch(
            `https://indexing.bounce.tech/trade/${txHash}`,
          ).then((r) => r.json());

          if (cancelled) return;
          if (res.status !== "success") return;
          if (!res.data) return;

          const trade = res.data;

          const meta = pendingTrades[txHash];

          if (meta.type === "mint") {
            dispatch(setMintedAmountBigInt(BigInt(trade.leveragedTokenAmount)));
          }

          if (meta.type === "redeem") {
            dispatch(setTransactionProcessing(false));
            trackEvent("redeem_action", {
              label: "redeem_successful",
            });
            if (redeemModalStage === "closed") {
              dispatch(
                setToast({
                  isOpen: true,
                  variant: "success",
                  content: "Redeem successful!",
                  loadingIcon: false,
                  id: crypto.randomUUID(),
                }),
              );
              trackEvent("redeem_action", {
                label: "redeem_successful_toast_displayed",
              });
            } else {
              dispatch(
                setRecievedPnl({
                  profitAmount: bigIntToNumber(BigInt(trade.profitAmount), 6),
                  profitPercent: bigIntToNumber(
                    BigInt(trade.profitPercent),
                    18,
                  ),
                }),
              );
              dispatch(setRecievedBaseAmount(trade.baseAssetAmount));
              dispatch(setRedeemModalStage("success"));
              trackEvent("redeem_action", {
                label: "redeem_success_modal_displayed",
              });
            }
          }

          dispatch(removePendingTrade(txHash));
        }),
      );
    };

    const interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingTrades, redeemModalStage, dispatch]);
};
