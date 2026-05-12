import { useNavigate } from "react-router";

import styles from "./ProfileButton.module.css";
import { PROFILE_PATH } from "../../app/routes";
import { useProfileFace } from "../../utils/profileFace";

export default function ProfileButton() {
  const navigate = useNavigate();
  const face = useProfileFace();

  return (
    <button
      type="button"
      className={styles.profileBtn}
      onClick={() => navigate(PROFILE_PATH)}
      aria-label="Open profile"
    >
      <span className={styles.face}>{face}</span>
    </button>
  );
}
