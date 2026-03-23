import { useEffect } from "react";

import { WidgetEvent, useWidgetEvents } from "@lifi/widget";
import { useDispatch } from "react-redux";
import { useSwitchChain, useAccount } from "wagmi";

import { trackEvent } from "../../../analytics/ga";
import { setToast } from "../../../state/toastSlice";

export const LifiModalListener = ({
  onRouteCompleted,
}: {
  onRouteCompleted?: () => void;
}) => {
  const dispatch = useDispatch();
  const widgetEvents = useWidgetEvents();
  const { switchChain } = useSwitchChain();
  const { chain } = useAccount();

  useEffect(() => {
    // 1️⃣ Sync source chain
    const onSourceChainTokenSelected = ({
      chainId,
    }: {
      chainId: number;
      tokenAddress: string;
    }) => {
      if (chain?.id === chainId) return;
      if (!switchChain) return;

      try {
        switchChain({ chainId });
      } catch (err) {
        console.error("Failed to switch chain", err);
      }
    };

    // 2️⃣ Handle route completion
    const onRouteExecutionCompleted = () => {
      if (onRouteCompleted) {
        onRouteCompleted();
        dispatch(
          setToast({
            isOpen: true,
            variant: "success",
            content: "Bridge successful!",
            loadingIcon: false,
            id: crypto.randomUUID(),
          }),
        );
        trackEvent("deposit_action", {
          label: "bridged_successfully",
        });
      }
    };

    widgetEvents.on(
      WidgetEvent.SourceChainTokenSelected,
      onSourceChainTokenSelected,
    );

    widgetEvents.on(
      WidgetEvent.RouteExecutionCompleted,
      onRouteExecutionCompleted,
    );

    return () => {
      widgetEvents.off(
        WidgetEvent.SourceChainTokenSelected,
        onSourceChainTokenSelected,
      );
      widgetEvents.off(
        WidgetEvent.RouteExecutionCompleted,
        onRouteExecutionCompleted,
      );
    };
  }, [widgetEvents, chain?.id, switchChain, onRouteCompleted, dispatch]);

  return null;
};
