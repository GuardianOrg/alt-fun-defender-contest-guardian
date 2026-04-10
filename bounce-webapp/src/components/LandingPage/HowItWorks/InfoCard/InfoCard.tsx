import styles from "./InfoCard.module.css";

interface InfoCardProps {
  icon: React.ReactNode;
  text: string;
  focusedText: string;
}

const InfoCard = ({ icon, text, focusedText }: InfoCardProps) => {
  return (
    <div className={styles.infoCard}>
      {icon}
      <div className={styles.text}>
        {text} <span className={styles.focusedText}>{focusedText}</span>
      </div>
    </div>
  );
};

export default InfoCard;
