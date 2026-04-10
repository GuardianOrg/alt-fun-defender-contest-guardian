import { useDispatch } from "react-redux";

import PositionCard from "./PositionCard/PositionCard";
import styles from "./PositionGrid.module.css";
import { useSelectPositionAndNavigate } from "../../../../pages/MintPage/useMintPageRouting";
import { setOpenRedeemModal } from "../../../../state/mintSlice";

import type { LeveragedTokenData } from "../../../../types/leverageTokenData";

interface PositionGridProps {
  positions: LeveragedTokenData[];
}

const PositionGrid = ({ positions }: PositionGridProps) => {
  const dispatch = useDispatch();
  const selectPositionAndNavigate = useSelectPositionAndNavigate();

  return (
    <div className={styles.positionGrid}>
      {positions.map((position) => (
        <PositionCard
          key={position.symbol}
          position={position}
          onSelect={() => selectPositionAndNavigate(position)}
          onRedeem={() => {
            dispatch(setOpenRedeemModal(position));
          }}
        />
      ))}
    </div>
  );
};

export default PositionGrid;
