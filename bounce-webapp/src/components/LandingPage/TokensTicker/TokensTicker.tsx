import styles from "./TokensTicker.module.css";
import aave from "../../../assets/logos/aave.svg";
import aster from "../../../assets/logos/aster.svg";
import bitcoin from "../../../assets/logos/bitcoin.svg";
import bnb from "../../../assets/logos/bnb.svg";
import ethereum from "../../../assets/logos/ethereum.svg";
import google from "../../../assets/logos/google.svg";
import hyperliquid from "../../../assets/logos/hyperliquid.svg";
import monad from "../../../assets/logos/monad.svg";
import nvidia from "../../../assets/logos/nvidia.svg";
import paxg from "../../../assets/logos/paxg.svg";
import plasma from "../../../assets/logos/plasma.svg";
import pump from "../../../assets/logos/pump.svg";
import solana from "../../../assets/logos/solana.svg";
import sui from "../../../assets/logos/sui.svg";
import tesla from "../../../assets/logos/tesla.svg";
import xrp from "../../../assets/logos/xrp.svg";
import zec from "../../../assets/logos/zec.svg";
import zen from "../../../assets/logos/zen.svg";

const tokenSvgs = [
  monad,
  google,
  zec,
  sui,
  bitcoin,
  xrp,
  tesla,
  solana,
  bnb,
  aave,
  paxg,
  nvidia,
  hyperliquid,
  plasma,
  ethereum,
  aster,
  pump,
  zen,
];

const TokensTicker = () => {
  return (
    <div className={styles.slide}>
      <div className={styles.longOrShort}>
        <span>Long or short&nbsp;</span> over 200 assets
      </div>

      <div className={styles.tickerWrapper}>
        <div className={styles.scroller}>
          <div className={styles.firstBlock}>
            <div className={styles.tokenRow}>
              {tokenSvgs.map((src) => (
                <img
                  key={src + "-1"}
                  src={src}
                  alt=""
                  className={styles.logo}
                />
              ))}
            </div>
            <div className={styles.spacer} />
          </div>

          <div className={styles.secondBlock}>
            <div className={styles.tokenRow}>
              {tokenSvgs.map((src) => (
                <img
                  key={src + "-2"}
                  src={src}
                  alt=""
                  className={styles.logo}
                />
              ))}
            </div>
            <div className={styles.spacer} />
          </div>
        </div>
      </div>
      <div className={styles.leverage}>at up to 10x leverage</div>
    </div>
  );
};

export default TokensTicker;
