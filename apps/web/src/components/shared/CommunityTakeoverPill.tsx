import styles from "./CommunityTakeoverPill.module.css";

interface CommunityTakeoverPillProps {
  title?: string;
}

export default function CommunityTakeoverPill({
  title = "This token has had a community takeover",
}: CommunityTakeoverPillProps) {
  return (
    <span className={styles.pill} title={title} aria-label="Community takeover">
      CTO
    </span>
  );
}
