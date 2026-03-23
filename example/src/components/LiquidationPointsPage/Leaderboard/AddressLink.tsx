import { LaunchIcon } from "../../../assets/LaunchIcon";
import useFormatAddress from "../../../hooks/useFormatAddress";
import { getPurrsecUrl } from "../../../utils/getPurrsecUrl.util";

import type { Address } from "viem";

const AddressLink = ({
  wallet,
  className,
  iconColorVar,
}: {
  wallet: Address;
  className?: string;
  iconColorVar: string;
}) => {
  const formatted = useFormatAddress(wallet);
  return (
    <a
      href={getPurrsecUrl(wallet)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {formatted}
      {LaunchIcon(iconColorVar)}
    </a>
  );
};

export default AddressLink;
