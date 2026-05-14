import CommandBar from "./CommandBar";
import Header from "./Header";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";
import styles from "./TerminalView.module.css";
import TokenTable from "./TokenTable";

export default function TerminalView() {
  return (
    <div className={styles.wrapper}>
      <Sidebar />
      <div className={styles.mainContent}>
        <Header />
        <div className={styles.tableSection}>
          <CommandBar />
          <TokenTable />
        </div>
      </div>
      <RightPanel />
    </div>
  );
}
