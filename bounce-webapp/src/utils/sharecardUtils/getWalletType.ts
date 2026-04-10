export const isIOSWallet = () => {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const isMobile = /iPhone|iPad|iPod/i.test(ua);
  if (!isMobile) return false;

  // iOS Safari
  const isSafari =
    /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);

  // iOS Wallets / WebViews
  const isWalletWebView =
    // common wallet UA strings
    /MetaMask|Rabby|Rainbow|CoinbaseWallet|Trust|Argent/i.test(ua) ||
    // injected providers
    Boolean(
      window.ethereum?.isMetaMask ||
      window.ethereum?.isRabby ||
      window.ethereum?.isCoinbaseWallet ||
      window.ethereum?.isTrust ||
      window.ethereum?.isArgent,
    );

  return isSafari || isWalletWebView;
};

export const isAndroidWallet = () => {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const isMobile = /Android/i.test(ua);
  if (!isMobile) return false;

  const isWalletWebView =
    // common wallet UA strings
    /MetaMask|Rabby|Rainbow|CoinbaseWallet|Trust|Argent/i.test(ua) ||
    // injected providers
    Boolean(
      window.ethereum?.isMetaMask ||
      window.ethereum?.isRabby ||
      window.ethereum?.isCoinbaseWallet ||
      window.ethereum?.isTrust ||
      window.ethereum?.isArgent,
    );

  return isWalletWebView;
};
