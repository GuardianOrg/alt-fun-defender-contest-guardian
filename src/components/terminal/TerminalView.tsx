import CommandBar from "./CommandBar";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";
import styles from "./TerminalView.module.css";
import TokenTable from "./TokenTable";
import { useTokens } from "../../hooks/useTokens";

export default function TerminalView() {
  const { data: tokens } = useTokens();

  return (
    <div className={styles.wrapper}>
      <Sidebar />
      <div className={styles.mainContent}>
        <CommandBar tokenCount={tokens?.length ?? 0} />
        <TokenTable />
      </div>
      <RightPanel />
    </div>
  );
}
