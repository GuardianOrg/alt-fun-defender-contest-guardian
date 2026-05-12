import { useState } from "react";

import styles from "./ProfileView.module.css";
import { useWallet } from "../../hooks/useWallet";
import { cn } from "../../utils/format";
import { cycleProfileFace, useProfileFace } from "../../utils/profileFace";

type ProfileTab = "balances" | "rewards" | "manage";

const TABS: { label: string; tab: ProfileTab }[] = [
  { label: "BALANCES", tab: "balances" },
  { label: "CREATOR REWARDS", tab: "rewards" },
  { label: "MANAGE FUNDS", tab: "manage" },
];

export default function ProfileView() {
  const { address, shortAddress, isConnected } = useWallet();
  const face = useProfileFace();
  const [activeTab, setActiveTab] = useState<ProfileTab>("balances");

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <div className={styles.hero}>
          <button
            type="button"
            className={styles.avatar}
            onClick={cycleProfileFace}
            title="Click to change face"
            aria-label="Change profile face"
          >
            <span className={styles.avatarFace}>{face}</span>
          </button>
          <div className={styles.identity}>
            <div className={styles.label}>profile</div>
            <div className={styles.address} title={address}>
              {isConnected ? shortAddress : "not connected"}
            </div>
          </div>
        </div>

        <div className={styles.tabBar}>
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              className={cn(
                styles.tab,
                activeTab === t.tab && styles.tabActive,
              )}
              onClick={() => setActiveTab(t.tab)}
            >
              <span>{t.label}</span>
              {activeTab === t.tab && (
                <span className={styles.indicator} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {/* Content for {activeTab} lands here in the next pass. */}
        </div>
      </div>
    </div>
  );
}
