# Bounce Webapp

A modern React web application for Bounce Tech, a DeFi protocol bringing leveraged tokens to the world's most liquid on-chain perpetual markets. Built with React, TypeScript, and Web3 technologies.

## 🚀 Overview

Bounce is a DeFi protocol that provides **leveraged tokens for all of finance**, powered by Hyperliquid's deep liquidity. The platform offers:

- **20x leverage without liquidations** - Constant leveraged exposure without the risk of liquidation
- **Ultra-efficient rebalancing** - Through HyperCore precompiles with industry-leading 0.045% rebalancing costs
- **DeFi composability** - The benefits of perpetuals with full DeFi integration
- **Passive management** - No active management required, just constant leveraged exposure

## 🛠 Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Styled Components
- **State Management**: Redux Toolkit, React Query
- **Web3**: Wagmi, RainbowKit, Viem
- **Blockchain**: HyperEVM (Hyperliquid's EVM)
- **Animations**: Framer Motion
- **Routing**: React Router
- **Build Tool**: Vite

## 🏗 Project Structure

```
src/
├── app/                 # App configuration and constants
│   ├── api.ts          # API endpoints
│   ├── config.ts       # App configuration
│   ├── constants.tsx   # App constants
│   ├── links.ts        # External links
│   ├── routes.ts       # Route definitions
│   └── wagmi.ts        # Web3 configuration
├── components/         # React components
│   ├── LandingPage.tsx # Main landing page
│   ├── RegisterPage.tsx # User registration
│   ├── Hero.tsx        # Hero section
│   ├── HowItWorks.tsx  # Features explanation
│   └── ...            # Other UI components
├── contexts/          # React contexts
├── data/             # Static data and content
├── handlers/         # Event handlers and utilities
├── hooks/            # Custom React hooks
├── state/            # Redux store and slices
├── styles/           # Global styles and themes
└── types/            # TypeScript type definitions
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Yarn
- A Web3 wallet (MetaMask, WalletConnect, etc.)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/bounce-tech/bounce-webapp.git
   cd bounce-webapp
   ```

2. **Install dependencies**

   ```bash
   yarn install
   ```

3. **Start the development server**

   ```bash
   yarn dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:5173`

### Building for Production

```bash
yarn build
```

## 🔧 Configuration

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Links

- **Website**: [bounce.tech](https://bounce.tech)
- **Twitter**: [@BounceTech](https://x.com/BounceTech)
- **Discord**: [discord.gg/T8DvHhCrGV](https://discord.gg/T8DvHhCrGV)
- **GitHub**: [github.com/bounce-tech](https://github.com/bounce-tech)

---

Built with ❤️ by the Bounce Tech team
