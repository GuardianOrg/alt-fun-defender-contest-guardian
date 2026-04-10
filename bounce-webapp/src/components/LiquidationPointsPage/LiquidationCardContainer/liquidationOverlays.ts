import billions from "../../../assets/liquidation-points/billions.png";
import hood from "../../../assets/liquidation-points/hood.png";
import laptopChungus from "../../../assets/liquidation-points/laptop-chungus.png";
import smokingChungus from "../../../assets/liquidation-points/smoking-chungus.png";
import spongebob from "../../../assets/liquidation-points/spongebob.png";
import tate from "../../../assets/liquidation-points/tate.png";
import warren from "../../../assets/liquidation-points/warren.png";

export type OverlayKey =
  | "spongebob"
  | "billions"
  | "hood"
  | "tate"
  | "warren"
  | "laptop-chungus"
  | "smoking-chungus";

export type OverlayOption = {
  key: OverlayKey;
  image: string;
};

export const OVERLAYS: OverlayOption[] = [
  { key: "laptop-chungus", image: laptopChungus },
  { key: "billions", image: billions },
  { key: "warren", image: warren },
  { key: "smoking-chungus", image: smokingChungus },
  { key: "spongebob", image: spongebob },
  { key: "hood", image: hood },
  { key: "tate", image: tate },
];
