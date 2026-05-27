import rowStyles from "./TokenRow.module.css";
import { cn } from "../../utils/format";
import Skeleton from "../shared/Skeleton";

import type { TokenViewMode } from "../../state/uiSlice";

/**
 * Layout-matched placeholder for `<TokenRow>`. Keeps every cell width in
 * sync with the live row so the grid doesn't reflow when `useTokens`
 * resolves and the skeletons swap for real rows.
 */
interface Props {
  viewMode: TokenViewMode;
}

export default function TokenRowSkeleton({ viewMode }: Props) {
  return (
    <div
      className={cn(
        rowStyles.row,
        viewMode === "grid" && rowStyles.cardRow,
        rowStyles.normalRow,
        rowStyles.borderMint,
      )}
      aria-hidden="true"
    >
      <div className={rowStyles.tokenCell}>
        <div className={rowStyles.iconWrap}>
          <Skeleton shape="block" width="4rem" height="4rem" radius="3px" />
        </div>
        <div className={rowStyles.nameWrap}>
          <Skeleton width="5.5rem" height="14px" />
          <Skeleton width="7rem" height="11px" />
        </div>
      </div>

      <div className={rowStyles.underlyingCell}>
        <Skeleton shape="circle" width="1.6rem" />
        <Skeleton width="3rem" height="13px" />
        <Skeleton width="4.5rem" height="13px" />
      </div>

      <div className={rowStyles.changeCell}>
        <Skeleton width="3.5rem" height="14px" />
      </div>

      <div className={rowStyles.progressCell}>
        <Skeleton shape="block" width="100%" height="6px" radius="3px" />
      </div>

      <div className={rowStyles.mcapCell}>
        <Skeleton width="4.5rem" height="14px" />
      </div>
    </div>
  );
}
