// --- 1. Environment ------------------------------------

export type AppEnv = "local" | "prbuild" | "prod";

const APP_ENV: AppEnv = (import.meta.env.VITE_APP_ENV as AppEnv) ?? "prod";

// --- 2. Feature flag shape ------------------------------

export type FeatureFlags = {
  registerRoute: boolean;
  liquidationScoreRoute: boolean;
  vestingRoute: boolean;
  mintRoute: boolean;
  lockRoute: boolean;
  stakeRoute: boolean;
  portfolioRoute: boolean;
  rewardsRoute: boolean;
  protocolLive: boolean;
};

// --- 3. Flags per environment ---------------------------

const FEATURE_FLAGS: Record<AppEnv, FeatureFlags> = {
  local: {
    registerRoute: true,
    liquidationScoreRoute: true,
    vestingRoute: false,
    mintRoute: true,
    lockRoute: false,
    stakeRoute: false,
    portfolioRoute: true,
    rewardsRoute: false,
    protocolLive: true,
  },

  prbuild: {
    registerRoute: true,
    liquidationScoreRoute: true,
    vestingRoute: false,
    mintRoute: true,
    lockRoute: false,
    stakeRoute: false,
    portfolioRoute: true,
    rewardsRoute: false,
    protocolLive: true,
  },

  prod: {
    registerRoute: true,
    liquidationScoreRoute: true,
    vestingRoute: false,
    mintRoute: true,
    lockRoute: false,
    stakeRoute: false,
    portfolioRoute: true,
    rewardsRoute: false,
    protocolLive: true,
  },
};

// --- 4. Resolve + freeze --------------------------------

const resolvedFlags: Readonly<FeatureFlags> = Object.freeze(
  FEATURE_FLAGS[APP_ENV],
);

// --- 5. Public API --------------------------------------

export function useFeatureFlags(): FeatureFlags {
  return resolvedFlags;
}
