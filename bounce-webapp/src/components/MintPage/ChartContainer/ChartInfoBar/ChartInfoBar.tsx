import styles from "./ChartInfoBar.module.css";
import TokenStats from "./TokenStats/TokenStats";
import DropdownButton from "../../TokenDropdown/DropdownButton/DropdownButton";

const ChartInfoBar = ({
  livePrice,
  setLivePrice,
}: {
  livePrice: number | null;
  setLivePrice: (price: number | null) => void;
}) => {
  return (
    <aside className={styles.container}>
      <DropdownButton />
      <TokenStats livePrice={livePrice} setLivePrice={setLivePrice} />
    </aside>
  );
};

export default ChartInfoBar;
