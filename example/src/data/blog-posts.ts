export interface BlogPost {
  title: string;
  excerpt: string;
  date: string;
  category: string;
  slug: string;
  content: string;
  seoTitle: string; // Should be 50 characters or less to avoid truncation
  seoDescription: string; // Ideal is 120 characters, max 150 characters
}

export const BLOG_POSTS: BlogPost[] = [
  {
    title: "Leveraged Tokens vs Perps on Hyperliquid",
    excerpt:
      "Why a 5x leveraged token and a 5x perp can produce very different results, even when the direction is right.",
    date: "2026-01-21",
    category: "Guides",
    slug: "leveraged-tokens-vs-perps-on-hyperliquid",
    seoTitle: "Leveraged Tokens vs Perps",
    seoDescription:
      "Learn how perps and leveraged tokens behave after entry, why trends reward constant leverage, and how volatility decay can reduce returns.",
    content:
      "<h2>Leveraged tokens vs perps on Hyperliquid</h2>\n\n<p>Most leveraged trades do not fail because the trader was wrong on direction. They fail because the position could not survive the sequence of price moves required to be right.</p>\n\n<p>Leverage makes outcomes path dependent. A position can be directionally correct and still fail if margin, leverage, and liquidation risk evolve unfavorably before the move plays out. This is why instruments that advertise the same headline leverage can produce materially different outcomes over time.</p>\n\n<p>To understand this, it is not enough to look at entry leverage. What matters is how leverage and margin behave after the trade begins.</p>\n\n<h2>Perpetual futures, single position exposure with a liquidation boundary</h2>\n\n<p>A perpetual future is a single margin position with a liquidation price.</p>\n\n<p>When a trader opens a 5x perp, leverage is exactly 5x at entry. A sufficiently adverse move at any point can terminate the position entirely, regardless of whether the market later moves in the intended direction.</p>\n\n<p>As price moves in favor of the position, unrealized PnL increases margin. As margin increases, effective leverage declines mechanically, and the liquidation price moves further away. The position becomes more resilient to adverse price movement as leverage declines.</p>\n\n<p>The cost of this design is that PnL sensitivity per unit of price movement declines over time. Later legs of a trend therefore contribute less incremental PnL than earlier ones, even though the position size in units remains unchanged.</p><img src='/blog/constant-vs-free-floating.png' />\n\n<h2>Leveraged tokens, constant leverage through rebalancing</h2>\n\n<p>Leveraged tokens are structured differently.</p>\n\n<p>Rather than maintaining a single position with fixed unit exposure, leveraged tokens periodically rebalance an underlying perpetual position to keep leverage near a specified target. As unrealized PnL changes margin, rebalancing adjusts position size. Unrealized gains increase notional exposure to restore target leverage, while unrealized losses reduce notional exposure to reduce liquidation risk.</p>\n\n<p>This allows the position to survive adverse moves and maintain leverage into later stages of a sustained trend, where a disproportionate share of PnL can be realized.</p>\n\n<h2>Trending prices reward constant leverage</h2>\n\n<img src='/blog/hype-lt-vs-perp.jpeg' />\n\n<p>HYPE entered a sustained uptrend over the period, with price appreciating steadily and acceleration occurring in the later stages of the move.</p>\n\n<ul>\n  <li>The 5x long leveraged token maintained leverage near its target through periodic rebalancing. As unrealized PnL increased margin, position size was adjusted to keep effective leverage close to 5x, preserving exposure throughout the trend.</li>\n  <li>The 5x long perpetual position de levered as margin increased. By the later stages of the move, effective leverage had fallen to approximately 1.4x, materially reducing PnL sensitivity during the strongest portion of the rally.</li>\n  <li>As a result, later legs of the trend contributed disproportionately more PnL to the leveraged token than to the perp position.</li>\n</ul>\n\n<p><strong>Result</strong></p>\n<ul>\n  <li><strong>Leveraged Token:</strong> +4,048.7%</li>\n  <li><strong>Perpetual Future:</strong> +807.2%</li>\n</ul>\n\n<p>The difference emerges from how leverage evolves over time, not from differences at entry.</p>\n\n<h2>Volatility decay, when constant leverage works against you</h2><img src='/blog/zec-lt-vs-perp.jpeg' />\n\n<h3>Period, 10 Dec 2025 to 15 Dec 2025, free floating versus constant leverage</h3>\n\n<p>This period illustrates volatility decay in practice.</p>\n\n<p>Price oscillated within a relatively tight range without establishing a sustained directional trend. During this regime, the leveraged token repeatedly rebalanced position size in response to unrealized PnL changes, converting volatility into drag.</p>\n\n<p>The perpetual position, by contrast, did not rebalance and therefore did not systematically convert volatility into losses.</p>\n\n<p><strong>Result</strong></p>\n<ul>\n  <li><strong>Leveraged Token:</strong> -3.2%</li>\n  <li><strong>Perpetual Future:</strong> +15.7%</li>\n</ul>\n\n<h2>Leverage is a structural choice</h2>\n\n<p>Perpetual futures and leveraged tokens express leverage in fundamentally different ways.</p>\n\n<p>Perps concentrate risk in a single position with fixed unit exposure, where leverage decays mechanically as margin grows and failure is realized through liquidation. Leveraged tokens maintain target leverage through rebalancing, keeping leverage applied through sustained trends while accepting volatility decay as a tradeoff.</p>\n\n<p>A 5x perp is only 5x at entry. What happens next depends on the instrument you choose.</p>",
  },
  {
    title: "How to bridge to HyperEVM",
    excerpt:
      "How to bridge HYPE and USDC to HyperEVM from any chain using Across",
    date: "2026-01-15",
    category: "Guides",
    slug: "bridge-to-hyperevm",
    seoTitle: "How to bridge to HyperEVM",
    seoDescription:
      "How to bridge HYPE and USDC to HyperEVM from any chain using Across",
    content: `
      <h2>Bridge directly on Bounce</h2>
      <p>You can now bridge to and from HyperEVM directly within Bounce. Click the <strong>Deposit</strong> button in the header to open the bridging popup, or when minting a leveraged token, you'll be prompted to bridge if you don't have enough funds.</p>
      <p><strong>Bonus:</strong> When you bridge to HyperEVM through Bounce and have no HYPE or a low HYPE balance, you'll automatically receive a small amount of HYPE for gas. This prevents you from being stuck with only USDC and unable to complete transactions.</p>

      <h2>What you need on HyperEVM</h2>
      <p>To trade on Bounce you need two assets.</p>
      <ul>
        <li><strong>HYPE</strong> for gas, we recommend at least <strong>1 dollar worth</strong>.</li>
        <li><strong>USDC</strong> to trade with.</li>
      </ul>

      <p>If you prefer to learn by watching a video, here is a step by step guide:</p>
      <p>
        <a href="https://www.youtube.com/watch?v=I1FUjvNind8" target="_blank" rel="noreferrer">
          Watch the HyperEVM bridging video on YouTube
        </a>
      </p>

      <h2>Step 1, choose a bridge app</h2>
      <p>There are multiple apps that support bridging to HyperEVM. We recommend using Across.</p>
      <ul>
        <li><a href="https://app.across.to/" target="_blank" rel="noreferrer">Across</a></li>
      </ul>

      <h2>Step 2, buy HYPE</h2>
      <ol>
        <li>Go to Across and connect your wallet.</li>
        <li>Select your source chain, for example Ethereum, Arbitrum, Solana, or BNB Chain.</li>
        <li>Select the asset you will pay with on the source chain, then enter an amount.</li>
        <li>Set the destination chain to <strong>HyperEVM</strong>.</li>
        <li>Set the destination asset to <strong>HYPE</strong>.</li>
        <li>Click <strong>Confirm Swap</strong>, then approve the transaction in your wallet.</li>
      </ol>

      <h2>Step 3, bridge USDC</h2>
      <p>Repeat the same flow, then set the destination asset to USDC.</p>
      <ol>
        <li>Go to Across and connect your wallet.</li>
        <li>Select your source chain.</li>
        <li>Select the asset you will pay with on the source chain, then enter an amount.</li>
        <li>Set the destination chain to <strong>HyperEVM</strong>.</li>
        <li>Set the destination asset to <strong>USDC</strong>.</li>
        <li>Click <strong>Confirm Swap</strong>, then approve the transaction in your wallet.</li>
      </ol>

      <h2>FAQ</h2>

      <h3>After bridging I do not see USDC in my wallet</h3>
      <p>Import the USDC token contract into your wallet:</p>
      <pre><code>0xb88339CB7199b77E23DB6E890353E22632Ba630f</code></pre>

      <h3>I cannot do anything after receiving USDC</h3>
      <p>You probably do not have enough HYPE for gas. Do the HYPE swap first or buy more if needed.</p>

      <h3>How do I add HyperEVM to my wallet?</h3>
      <p>In MetaMask or your wallet of choice, add a custom network using:</p>
      <ul>
        <li><strong>Network name:</strong> Hyperliquid</li>
        <li><strong>Chain ID:</strong> 999</li>
        <li><strong>Currency symbol:</strong> HYPE</li>
        <li><strong>RPC URL:</strong> https://rpc.hyperliquid.xyz/evm</li>
      </ul>

      <h2>Disclaimer</h2>
      <p>Bridging is operated by third party providers. It is not provided, operated, or endorsed by Bounce. Use at your own risk.</p>
      <p>Always do a small test amount first when using a bridge or swapping on a new chain.</p>
    `,
  },
  {
    title: "Hyperliquid Precompiles, An Inconvenient Truth",
    excerpt:
      "A field guide to Hyperliquid precompile gotchas, from async CoreWriter actions to view anomalies, fees, and tooling gaps, learned while building Bounce Tech.",
    date: "2026-01-23",
    category: "Engineering",
    slug: "hyperliquid-precompiles-an-inconvenient-truth",
    seoTitle: "Hyperliquid Precompiles, Gotchas and Fixes",
    seoDescription:
      "Learn the main Hyperliquid precompile edge cases, async CoreWriter pitfalls, balance timing gaps, USDC bridge quirks, view anomalies, and practical mitigations.",
    content:
      "<p>Hyperliquid Precompiles allow for read and writes between HyperEVM and HyperCore, enabling EVM applications to access the liquidity and functionality of Hyperliquid perps and more. They are broken down into CoreWriter Actions, which allow for transactions on HyperEVM that mutate state on HyperCore. And Precompiles, which allow for reading HyperCore state on HyperEVM. This unlocks new categories of applications that can be built using this new composable infrastructure. For example, a fully permissionless liquid staked token on HyperEVM, that stakes and unstakes on HyperCore using CoreWriter actions. Or a Tokenised Vault on HyperEVM, that is backed by perpetual futures positions on HyperCore.</p>\n\n<h2>Show me the code</h2>\n\n<p>There is nothing better than seeing some example code to understand how things work in practice. Below is a simple example of a smart contract that bridges USDC from HyperEVM to HyperCore perps balance. And exposes a view that returns the total value of the smart contract, EVM balance plus perp balance.</p>\n\n<img src='/blog/code-example.jpg' />\n\n<p>The totalAssets view is returning the USDC balance in the contract, and using the Account Margin Summary precompile to get the perp balance. The bridgeToPerp function is using a convenient CoreWriter Action that bridges from EVM to Perp balance in a single Action. And the bridgeFromPerp function is doing this in two steps, first transferring to spot, and then bridging from spot to EVM, as there is no shortcut way to do this in one transaction for the return. The code looks simple enough, and at a glance you can see how these Precompiles would be incredibly useful for building a host of applications that could not exist without them.</p>\n\n<p>However, what lies under the murky depths of this deceptively simple Solidity code is a shiver of exploitable edge cases waiting to strike. We will be going into all of these in this article, and surfacing each of them. For many of which it will be the first time they have been publicly documented.</p>\n\n<h2>Atomic vs Async</h2>\n\n<p>One ongoing challenge is that all HyperEVM actions are atomic, while all CoreWriter actions are async. As EVM developers, we become quite accustomed to our atomic flows, where steps are guaranteed to happen within a single block, and if one thing reverts, the whole transaction does. With CoreWriter Actions however, the EVM side is more of a request for the action to be processed, and any validations are done after the EVM transaction has gone through. This means that a CoreWriter Action can succeed on the EVM side, but then later fail on the HyperCore side.</p>\n\n<p>For example, looking at our bridgeFromPerp function. We first move our funds from perp to spot, and then from spot to EVM. However it would be theoretically possible for the first step to succeed, but for the second step to fail. Which would leave our funds stuck in the spot, with no way to recover them or to account for their balance in our existing contract.</p>\n\n<p>There unfortunately is no golden spear solution for this problem. Other than ensuring you are doing as many validations as you can before submitting the CoreWriter Actions to try match the HyperCore validations. And to never assume that a transaction will go through when building. Often easier said than done.</p>\n\n<h2>Order of Events</h2>\n\n<p>With most use cases of precompile reads, the value returned by your contract usually has some security implications for its accuracy. For example, our totalAssets view may be used to determine the value of the smart contract, used to allocate the exchange rate the receipt tokens should be minted at, or the value that a user can borrow collateral against. If this totalAssets is incorrect for even the briefest moment, this could lead to exploits in the wider protocol.</p>\n\n<p>This Atomic vs Async behaviour has one inconvenient implication. All EVM portions of the flow happen as soon as they are called within the block. However all CoreWriter Actions are processed by the next EVM block. Let us look at the flow for our bridgeToPerp function:</p>\n\n<img src='/blog/bridge-to-perp.png'/>\n\n<p>On the left are the EVM blocks, and we can see in block n we are calling the CoreWriterAction bridgeUsdcToCoreFor half way through the EVM block. On the right are our balances throughout this flow. What happens, is that as soon as the CoreWriter Action is called, our USDC is taken, to prevent double spending. However, our perp balance is not updated until the next EVM block once the action has been processed. This means that for a brief period, within block n but after our bridge call, the funds have been lost at sea. Which could be capitalised on by a willing pirate who smuggles a transaction into block n after the bridge, to capitalise on the now incorrect totalAssets view.</p>\n\n<p>To remediate this, a new storage value is needed in the contract that tracks the amount that is currently being bridged for each block. Then in the totalAssets view, this bridging amount would need to be added to the total to fill in the temporary gap.</p>\n\n<h2>USDC Quirks</h2>\n\n<p>The USDC bridge linking HyperEVM and HyperCore was a big unlock. Allowing for bridging native USDC between chains using Precompiles. There are however some hidden edge cases that need to be considered when integrating.</p>\n\n<p>The first is that Circle has a function in their bridge disableDexForwarding (<a href='https://github.com/circlefin/hyperevm-circle-contracts/blob/master/src/CoreDepositWallet.sol#L326' target='_blank'>see here</a>) that allows them to disable the functionality to bridge directly to your perps balance. What this means, is if you integrate with them to bridge directly from EVM to perp balance. They could at any time change this behaviour so that instead your funds are bridged to spot. Failing to account for this would mean funds are stuck in spot, with the full bridge flow failing. To account for this developers need to have a back up bridging flow that they switch to when the perps bridge is disabled.</p>\n\n<p>Another inconvenience is that the HyperEVM and HyperCore USDC bridge is not backed 1:1 with USDC. There is more USDC on HyperCore than there is in the USDC bridge. Which means it is possible that the USDC bridge could run out of USDC, causing bridges from perps to fail. There is no easy way to account for this, other than being aware with all integrations, that bridges can fail, with no remediation other than waiting until funds are replenished. This makes many classifications of protocols quite risky to build, including anything that depends on borrowing, as collateral could not be able to be liquidated when needed.</p>\n\n<h2>Fees and Activation</h2>\n\n<p>If you start testing in production, you will quickly find that nothing is working. Bridging transactions are not going through, none of your CoreWriter Actions are triggering. And from the error messages, it is not clear why. The likely reason is that you have not paid the various fees required for these actions to go through.</p>\n\n<p>The first one is that for any CoreWriter action to work, the Smart Contract must first be Activated. To do this, you need to send some USDC to it on HyperCore. This triggers the Activation process. 1 USDC should be enough, we are always paranoid and send 2.</p>\n\n<p>The second common issue here is that bridging CoreWriter Actions are not free, and require balances to pay for fees. Bridging from Core to EVM requires HYPE or USDC on HyperCore spot. If you have both balances, it will take from the HYPE balance first. And bridging from EVM to Core requires HYPE on HyperEVM. For any production protocol, it is necessary to then manage these balances to ensure they always have enough for the bridge to go through, and if your architecture requires having multiple smart contracts, then you can quickly get into a web of balance management and topups.</p>\n\n<h2>Reading Views</h2>\n\n<p>Surely we can just read a smart contract view right? Surely there is no delicate web of requirements and edge cases for a simple read?</p>\n\n<p>Inconveniently, it is not possible through any current RPC provider to query any smart contract view that includes a Precompile at a historic block. Querying at latest works most of the time. But querying anything in the past is not possible. This makes a whole host of product features impractical or impossible to implement. Even a simple feature like showing a chart of TVL is no simple feat. The workaround used for this is to create a database where precompile views are queried every block, once per second, and this data is written into a database. Which can then be queried for things like showing a chart of TVL. But this does not scale well when you start considering saving data that is not global, for example users specific views that take parameter inputs.</p>\n\n<p>Most traditional blockchain indexing solutions do not work as almost all are using a backfill architecture. Where they historically query views to populate and build the database. Which will revert for any historic query.</p>\n\n<p>Once a custom live indexing solution is in place, the data can show anomalies.</p>\n\n<img src='/blog/hype-wick.png' />\n\n<p>Sharp and unexpected changes in values that last only for a single block. A scary thought, as with many views this could lead to an exploit. So what is going on here?</p>\n\n<p>As a specific example for this issue, let us refer back to our bridging contract, and our totalAssets view. For the bridgeFromPerp function. Here is a diagram for the flow of funds:</p>\n\n<img src='/blog/usdc-transfer.jpg' />\n\n<p>We make the CoreWriter Action call in EVM block n. Nothing happens in that block though, as the action is fully async here so will be processed in part between blocks, and in part at the start of the next block. Between blocks the Perp balance is decreased, so from block n plus 1 onwards, the perp balance is 0 as expected. The way that the USDC bridge works is that it is done as a transfer to the destination, but at the very start of the block. That means, that at the start of the block, before the transfer happens, the funds have magically disappeared again. However, because the transfer always happens at the start of the block, we know that any transactions we have in that block will be after the transfer, and so the funds will appear in our EVM balance. So practically, on the EVM side, we have a full track of funds at all times and there is no issue.</p>\n\n<p>However, for an RPC provider, it is not practical for them to return view data from the perspective of what an expected EVM transaction would experience part way through a block. And so, depending on how the RPC is implemented, they return 0 for both the spot and perp balance, usually in block n plus 1 and sometimes in block n. We replicated this behaviour with every RPC we tested, and our auditors tested with.</p>\n\n<p>So we have a weird form of Schrodinger's box, where the cat is either dead or alive, depending on who is opening the box.</p>\n\n<img src='/blog/cat-in-box.jpg' />\n\n<p>There is no clean solution for this problem that we have found. The options at a high level are to resolve this offchain, by looking at event logs to detect when a bridge happened, and then modify the response for the following block based on that. Or to resolve this onchain, by writing to storage when a bridge happens, and return some modified view that is only read by RPCs that increments this amount for that block. Or, to just avoid reading from RPC views in the blocks following a bridge. In other words, to just avoid opening the box.</p>\n\n<h2>API Wallets</h2>\n\n<p>In an ideal world, the CoreWriter Actions should contain everything you need to build your protocol. That way you can keep all logic fully self contained within the smart contract. We are so close to this, however some obvious and critical things are missing. As an example, if you are wanting to build some vault that is backed by a perp position. You need a few CoreWriter Actions to achieve this:</p>\n\n<ul>\n  <li>Bridge between HyperEVM and HyperCore Spot</li>\n  <li>Convert between HyperCore Spot to HyperCore Perp</li>\n  <li>Update Leverage</li>\n  <li>Create an Order on HyperCore</li>\n</ul>\n\n<p>Inconveniently, we have everything we need from this list, but missing the simplest of all of these, which is the ability to Update Leverage using a CoreWriter Action.</p>\n\n<p>This means that to achieve this goal, API Wallets are needed. API Wallets allow an external wallet to make actions on behalf of a user. The user adds a wallet as an API Wallet for itself, and can also remove this permission later. An API Wallet needs to not have any previous history on HyperCore to be added as an API Wallet. There is a CoreWriter Action to add an API Wallet, so this can be achieved with smart contracts. Essentially, the helm of the boat is passed over to an API Wallet friend to control things for a bit.</p>\n\n<p>However, as usual, there is another inconvenience here. For some reason, API Wallets are not able to convert between HyperCore Spot and Perp balances for a user. So instead the final architecture needs to be a hybrid, where the API Wallet makes some calls and the smart contract makes some calls. Just to achieve what would be described as one of the most primitive and marketed use cases of Precompiles. To bring HyperCore liquidity onto HyperEVM.</p>\n\n<h2>Tooling</h2>\n\n<p>So, we have weathered the storm, and docked at port. We have got a working smart contract, with all edge cases handled, and the anchor is out. What is the experience outside of the code for developing and maintaining a protocol on HyperEVM?</p>\n\n<p>Inconveniently there are some challenges developing on HyperEVM with Foundry. One is that there is no test tooling that allows for the real simulation of calls to any Precompile or CoreWriter Actions. So the only way to test this for real is to deploy to production. In a codebase you will find endless mocks are needed to test the flow of funds. Also, using Foundry scripts, you are not able to make any calls that read from a Hyperliquid Precompile. So if a smart contract contains a precompile read as part of deployment, then the protocol instead has to be deployed in JavaScript or Python. If any maintenance functions require a Precompile read, then again you are out of Foundry.</p>\n\n<p>The developer support is tough. The docs are missing lots of data, and there is little community support when you get stuck. Helpful support from community members can make a big difference when questions come up, but for the wider public that is building and just using public support channels and docs, there is regular feedback about the inability to find information. To anonymously quote one of our auditors, \"The docs were even contradicting some time, and got little, sometimes even hostile, responses in Discord\".</p>\n\n<img src='/blog/high-five.jpg' />\n\n<p>There are still a lot of major infra providers that are not on HyperEVM yet. A common model these infra providers use is that the blockchain pays them to set up their infrastructure on that chain, and then the infra is free for all users on that chain. However, Hyperliquid has a strict policy that they do not pay for integrations. Which means that for the foreseeable future, any infra provider with this pricing model will not be on HyperEVM.</p>\n\n<p>It was still possible to find enough great infra providers to build out Bounce Tech. A few that worked well were:</p>\n\n<ul>\n  <li>Alchemy and QuickNode for a HyperEVM enabled RPC</li>\n  <li>Ponder as an indexing solution</li>\n  <li>HypeRPC as a drop in replacement for the Hyperliquid API with higher rate limits</li>\n  <li>LiFi for an npm package for adding bridging support</li>\n  <li>hyper-evm-lib as a must have library for any Precompile integration</li>\n</ul>\n\n<p>While not a tool specifically, auditors with experience in the Hyperliquid Precompiles can help a lot. Examples include Guardian Audits, Obsidian and Phage. We have also heard good things about Bailsec but have not had a chance to work with them yet.</p>\n\n<h2>How do we improve?</h2>\n\n<p>How can we strengthen the Hyperliquid ship, and stop the leak? The biggest single win for the development experience on HyperEVM would be the introduction of a Developer Relations team. Despite all of the challenges of integrating, having a point of call to help out during these times would have saved months of work. Someone to jump on a call with and walk through some of the current blockers. This would enable teams to deliver products much faster, and much more securely to HyperEVM and would be a massive unlock for the space.</p>\n\n<p>And from this, to have a meaningful product feedback loop. If there are regular complaints that some aspect of the integration is not clear. Then the docs should be updated to help with this. Developers should be reached out to see what features they would like and what could be improved, and that feedback should be fed back into the development lifecycle. It feels like right now there is not currently a positive feedback loop. The same questions are asked again and again in Discord, usually unanswered. And not unfounded, as there is simply no information online about them.</p>\n\n<p>In terms of what actual features or changes would help. A big one is HIP 3 precompile support, it would be great to have the ability to bring these onto HyperEVM. A centralised fee and gas bank would be a big UX improvement, add HYPE to some core balance, and all of your bridging and API Wallet calls would be covered by that for delegated contracts and agents. Historic Precompile reads would be a massive improvement if somehow possible. Adding an Update Leverage CoreWriter Action would add the missing piece for fully onchain trading. And allowing USD Class Transfer calls from an API Wallet would also improve API Wallet flows quite a lot.</p>\n\n<p>It is worth noting that while the development experience currently is not great. It is still very early. A lot of this tech is still very new. There are a huge amount of incredible developers and community members that are working to improve the space every day. We remain highly optimistic about the future of Hyperliquid and the HyperEVM. But optimism only matters if we're willing to fix what's broken.</p>",
  },
  {
    title: "Introducing Bounce Tech",
    excerpt:
      "Bounce.Tech brings leveraged tokens to HyperEVM, backed by Hyperliquid perps, up to 10x leverage, zero liquidation, fully composable ERC-20 tokens.",
    date: "2026-01-19",
    category: "Information",
    slug: "introducing-bounce-tech",
    seoTitle: "Introducing Bounce Tech",
    seoDescription:
      "Bounce.Tech brings leveraged tokens to HyperEVM, backed by Hyperliquid perps, up to 10x leverage, zero liquidation, fully composable ERC-20 tokens.",
    content: `
      <h2>Introducing Bounce.Tech</h2>
  
      <p>The Hyperliquid ecosystem is about to evolve. While Hyperliquid was built to house every financial product imaginable, a massive piece of the puzzle has been missing: leveraged tokens. Until now, traders seeking leverage were forced into monitoring perpetual futures positions, exposing themselves to constant liquidation risks.</p>
  
      <p><a href="https://bounce.tech/" target="_blank" rel="noreferrer">Bounce.Tech</a> is here to change that.</p>
  
      <h2>Leveraged tokens for all of finance</h2>
  
      <p><a href="https://bounce.tech/" target="_blank" rel="noreferrer">Bounce.Tech</a> is a leveraged tokens protocol built on HyperEVM. By utilizing Hyperliquid perpetual futures as backing, Bounce brings truly scalable leveraged tokens to DeFi.</p>
  
      <ul>
        <li><strong>Asset Support:</strong> Mint and redeem tokens for over 200 different assets.</li>
        <li><strong>Constant Leverage:</strong> Access up to 10x leverage and capture every market move without having to rebalance.</li>
        <li><strong>Zero Liquidation:</strong> Unlike perps, leveraged tokens are non-liquidating, meaning you can stay in the game while others are forced out.</li>
        <li><strong>Fully Composable:</strong> All Hyperliquid assets can now be tokenized. Every Bounce token is a standard ERC-20. They sit in your wallet, can be transferred freely, and are backed by deep liquidity with ultra-low rebalancing costs.</li>
      </ul>
  
      <h2>Perps. Tokens. DeFi</h2>
  
      <p>Bounce tokens aren't just for trading; they are tokenized representations of Hyperliquid perps that unlock the full potential of your capital.</p>
  
      <p>Normally, margin is locked away to back a single position. With Bounce, your margin becomes productive. Through rehypothecation, you can use your leveraged positions for a variety of DeFi applications:</p>
  
      <ul>
        <li>Borrowing and lending.</li>
        <li>Providing liquidity.</li>
        <li>New use cases like ██████  ██████</li>
      </ul>
  
      <h2>Launch</h2>
  
      <p>The development of Bounce began in Q2 2025, and after months of quiet, focused building, we are ready to emerge. Bounce will not be launching with tacky engagement farms or soulless yapping. We are focused on delivering a core financial primitive that the ecosystem desperately needs.</p>
  
      <p>Over the next week, we will release critical product and community updates. To stay up to date, join us on <a href="https://discord.com/invite/T8DvHhCrGV" target="_blank" rel="noreferrer">Discord</a>. We do not take your attention for granted.</p>
  
      <p>Bounce.</p>
    `,
  },
];

// Helper function to get a blog post by slug
export const getBlogPostBySlug = (slug: string): BlogPost | undefined => {
  return BLOG_POSTS.find((post) => post.slug === slug);
};
