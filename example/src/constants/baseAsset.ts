import { USDC_ADDRESS } from "@bouncetech/contracts";

import usdc from "../assets/logos/usdc.svg";

import type { InputAsset } from "./inputAssets";
import type { Address } from "viem";

export const baseAsset = {
  address: USDC_ADDRESS as Address,
  symbol: "USDC" as InputAsset,
  decimals: 6,
  logo: usdc,
};
