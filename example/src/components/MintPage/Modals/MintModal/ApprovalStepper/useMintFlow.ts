import { useDispatch } from "react-redux";

import { baseAsset } from "../../../../../constants/baseAsset";
import {
  setStepperError,
  setStepperStage,
} from "../../../../../state/mintSlice";
import { useBaseAssetApprovalBalance } from "../../../../../web3/views/useBaseAssetApprovalBalance";
import useApprove from "../../../../../web3/writes/useApprove";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";

interface UseMintFlowParams {
  mintAmount: bigint;
  leverageToken: LeveragedTokenData;
  mintTokens: () => Promise<void>;
}

export const useMintFlow = ({
  mintAmount,
  leverageToken,
  mintTokens,
}: UseMintFlowParams) => {
  const dispatch = useDispatch();
  const approve = useApprove(baseAsset.address);

  const approvalBalance =
    useBaseAssetApprovalBalance(leverageToken.address) || 0n;

  const handleMintFlow = async () => {
    try {
      if (approvalBalance < mintAmount) {
        dispatch(setStepperStage("approvalPending"));
        await approve(leverageToken.address);
      }
      dispatch(setStepperStage("mintPending"));
      await mintTokens();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      dispatch(setStepperError());
    }
  };

  return { handleMintFlow };
};
