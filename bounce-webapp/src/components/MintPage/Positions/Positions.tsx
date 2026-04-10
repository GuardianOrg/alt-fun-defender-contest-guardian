import { useDispatch, useSelector } from "react-redux";

import PositionGrid from "./PositionGrid/PositionGrid";
import styles from "./Positions.module.css";
import { Grid } from "../../../assets/Grid";
import { List } from "../../../assets/List";
import {
  selectGridOrListView,
  setGridOrListView,
} from "../../../state/mintSlice";
import useBounceAccount from "../../../web3/views/useBounceAccount";
import useUsersLeveragedTokens from "../../../web3/views/useUsersLeveragedTokens";
import Button from "../../Global/Buttons/Button";
import PositionList from "../../Global/PositionList/PositionList";
import ZeroStateContainer from "../../Global/ZeroStateContainer/ZeroStateContainer";
import RedeemModal from "../Modals/RedeemModal/RedeemModalContainer";

const Positions = () => {
  const dispatch = useDispatch();
  const { isConnected } = useBounceAccount();
  const usersLeveragedTokens = useUsersLeveragedTokens();

  const positions = usersLeveragedTokens?.filter(
    (position) => position.balanceOf > 0,
  );

  const gridOrListView = useSelector(selectGridOrListView);

  return (
    <div className={styles.positionsContainer}>
      <div className={styles.positionsTitleContainer}>
        <h3 className={styles.positionsTitle}>
          Positions{" "}
          {positions &&
            positions.length > 0 &&
            isConnected &&
            "(" + positions.length + ")"}
        </h3>
        {positions && positions.length > 0 && isConnected && (
          <div className={styles.layoutButtons}>
            <button
              className={gridOrListView === "list" ? styles.selected : ""}
              onClick={() => dispatch(setGridOrListView("list"))}
            >
              List
              <List
                color={
                  gridOrListView === "list"
                    ? "var(--primary-500-or-white)"
                    : "var(--primary-400-or-white)"
                }
                size={12}
              />
            </button>
            <button
              className={gridOrListView === "grid" ? styles.selected : ""}
              onClick={() => dispatch(setGridOrListView("grid"))}
            >
              Grid
              <Grid
                color={
                  gridOrListView === "grid"
                    ? "var(--primary-500-or-white)"
                    : "var(--primary-400-or-white)"
                }
                size={12}
              />
            </button>
          </div>
        )}
      </div>
      {!isConnected && (
        <ZeroStateContainer>
          <p>Connect your wallet to view your positions</p>
          <Button variant="primary" addressRequired />
        </ZeroStateContainer>
      )}
      {isConnected && positions && positions.length === 0 && (
        <ZeroStateContainer>
          <p>You have no open positions</p>
        </ZeroStateContainer>
      )}

      {isConnected &&
        positions &&
        positions.length > 0 &&
        (gridOrListView === "list" ? (
          <PositionList positions={positions} />
        ) : (
          <PositionGrid positions={positions} />
        ))}
      <RedeemModal />
    </div>
  );
};

export default Positions;
