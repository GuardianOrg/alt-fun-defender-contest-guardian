import CountUp from "react-countup";
import { Link } from "react-router";

import styles from "./StatCard.module.css";
import readMoreIcon from "../../../assets/read-more.svg";
import ComingSoon from "../../Global/ComingSoon/ComingSoon";

interface StatCardProps {
  primary?: boolean;
  value: string;
  currency?: string;
  supertext?: string;
  label: string;
  details?: string;
  readMoreLink?: string;
  readMoreLinkComingSoon?: boolean;
}

const StatCard = ({
  primary,
  value,
  currency,
  supertext,
  label,
  details,
  readMoreLink,
  readMoreLinkComingSoon,
}: StatCardProps) => {
  let prefix = "";
  let number = "";
  let suffix = "";
  const chars = value.split("");
  for (const char of chars) {
    const isNumberAdjacent = [".", ","].includes(char);
    const charNumber = Number(char);
    const charIsNumber = !isNaN(charNumber);
    if (charIsNumber || isNumberAdjacent) {
      number += char;
    } else {
      if (number.length > 0) {
        suffix += char;
      } else {
        prefix += char;
      }
    }
  }

  return (
    <div
      className={[
        styles.statCard,
        primary && styles.statCardPrimary,
        currency && styles.hasCurrency,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.topSection}>
        <div>
          <div className={styles.valueContainer}>
            {prefix && (
              <div
                className={[styles.value, primary && styles.valuePrimary]
                  .filter(Boolean)
                  .join(" ")}
              >
                {prefix}
              </div>
            )}
            <div
              className={[styles.value, primary && styles.valuePrimary]
                .filter(Boolean)
                .join(" ")}
            >
              <CountUp
                decimals={number.split(".")[1]?.length || 0}
                end={Number(number)}
                duration={2}
              />
            </div>
            {suffix && (
              <div
                className={[styles.value, primary && styles.valuePrimary]
                  .filter(Boolean)
                  .join(" ")}
              >
                {suffix}
              </div>
            )}
            {currency && (
              <div
                className={[styles.currency, primary && styles.currencyPrimary]
                  .filter(Boolean)
                  .join(" ")}
              >
                {currency}
              </div>
            )}
            {supertext && (
              <div
                className={[
                  styles.supertext,
                  primary && styles.supertextPrimary,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {supertext}
              </div>
            )}
          </div>
        </div>
        <div
          className={[styles.label, primary && styles.labelPrimary]
            .filter(Boolean)
            .join(" ")}
        >
          {label}
        </div>
      </div>
      {details && (
        <div
          className={[styles.details, primary && styles.detailsPrimary]
            .filter(Boolean)
            .join(" ")}
        >
          {details}
        </div>
      )}
      {readMoreLink && (
        <div>
          <ComingSoon comingSoon={readMoreLinkComingSoon || false}>
            <Link
              to={readMoreLink}
              className={[
                styles.readMoreLink,
                primary && styles.readMoreLinkPrimary,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              Read more{" "}
              <img src={readMoreIcon} className={styles.readMoreLinkIcon} />
            </Link>
          </ComingSoon>
        </div>
      )}
    </div>
  );
};

export default StatCard;
