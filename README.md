# Bow

A hybrid AI staking primitive on Arc, Circle's stablecoin L1.

Bow is an autonomous treasury agent that allocates user deposits across
three Circle-native assets on Arc:

| Asset | Role | Yield source |
|---|---|---|
| **USDC** | Pure stable, gas token of Arc | None, zero internal slippage |
| **USYC** | Circle US Yield Coin | Tokenized US Treasury bills, ~3.5% APY |
| **EURC** | Circle Euro Coin | FX exposure to EUR/USD |

Every allocation decision is reasoned by Claude Haiku 4.5, logged on-chain
in the DecisionLog contract, and challenged by humans in a 24h Turing
tournament settled on-chain.

## Why Bow exists

Most yield vaults today force you to pick one allocation and live with it
for months. When market conditions shift, you stay in the wrong asset, you
capture less yield with more risk than you should. AI-managed vaults exist,
but they are black boxes. You trust, you hope.

Bow combines both: the dynamic rebalancing of an AI agent, the verifiability
of public on-chain reasoning, and the discipline of a cooldown withdraw that
prevents flash-deposit sandwich attacks on the rebalance call.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 USER (USDC / USYC / EURC)                │
└──────────────────────┬───────────────────────────────────┘
                       │ deposit / requestWithdraw / claimWithdraw
                       ▼
┌──────────────────────────────────────────────────────────┐
│                       HybridVault                        │
│  - 3-asset accounting                                    │
│  - Shares + cooldown withdraw (1 round lock)             │
│  - executeAllocation(...) gated on min delta + cooldown  │
└──────┬───────────────────┬─────────────────────┬─────────┘
       │                   │                     │
       ▼                   ▼                     ▼
┌────────────┐     ┌────────────────┐    ┌──────────────────┐
│ DecisionLog│     │ TournamentVault│    │  Off-chain agent │
│ (reasoning │     │ (AI vs humans, │    │  (Claude Haiku   │
│   record)  │     │  24h rounds)   │    │   4.5 + cron)    │
└────────────┘     └────────────────┘    └──────────────────┘
                                                  │
                                                  ▼
                           CGI loop every 6h on Arc testnet:
                            read state -> reason -> rebalance -> log
```

## Stack

- **Smart contracts:** Solidity 0.8.24, OpenZeppelin v5, Foundry, deployed
  on Arc testnet (chain ID 5042002)
- **Off-chain agent:** Node 22, Anthropic SDK (Claude Haiku 4.5), GitHub
  Actions cron every 6 hours
- **Frontend:** Next.js 16, Tailwind v4, wagmi v3, viem, Arc theme
- **Circle primitives integrated:**
  - USDC (native gas token on Arc)
  - USYC (T-bill yield)
  - EURC (Euro stablecoin, FX leg)
  - Circle Wallets API (planned, email-based onboarding)
  - Circle Paymaster (planned, gasless first deposit)
  - Circle App Kit Swap (planned, real rebalance execution)

## On-chain config (Arc testnet)

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- Native gas: USDC (18 decimals)

### Bow contracts

To be filled after first deployment:

| Contract | Address |
|---|---|
| HybridVault | `0x...` |
| DecisionLog | `0x...` |
| TournamentVault | `0x...` |
| AI operator | `0x...` |

### Circle native contracts on Arc

| Contract | Address |
|---|---|
| USDC | `0x3600000000000000000000000000000000000000` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| CCTP TokenMessenger v2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |

## Run locally

```bash
# Frontend
npm install
npm run dev

# Contracts
cd contracts
forge install
PRIVATE_KEY=0x... ARC_AI_OPERATOR=0x... forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

Then paste the resulting addresses into `lib/chains.ts` (`bowVault`,
`decisionLog`, `tournamentVault`).

## Roadmap

| Stage | What it unlocks |
|---|---|
| **Today** | Notional vault on Arc testnet. AI rebalances, decisions logged, tournament rounds open and settle. No real DEX swaps yet (Arc testnet DEX liquidity is bootstrap phase). |
| **Next** | Real swap execution via Arc DEX or Circle App Kit Swap. Live human voting on rounds. Circle Wallets onboarding (email signup, no MetaMask). Paymaster gasless first deposit. |
| **Later** | Price oracle integration for accurate share valuation. Multi-currency basket extension (sUSDe, sDAI). Cross-chain via CCTP. Audit by recognised Web3 firm. |

## Hackathon submission

Submitted to the **Agora Agents Hackathon** by Canteen, Circle and Arc.

- Target track: Adaptive Portfolio Manager (RFB #4)
- Circle Tool Usage: USDC + USYC + EURC + (planned) Wallets, Paymaster, App Kit Swap, CCTP

## License

MIT.
