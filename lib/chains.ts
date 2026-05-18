/// Chain configuration for Bow on Arc (Circle's stablecoin L1).
///
/// Arc is currently testnet only (no mainnet as of 2026-05). USDC is the
/// native gas token on Arc (18 decimals), which is the most unusual property
/// of this chain and the reason Bow can run gasless flows trivially.

export const ARC_TESTNET = {
  id: 5042002,
  name: 'Arc Testnet',
  shortName: 'arc',
  // Server-side RPC: Canteen-issued personal endpoint. Authenticated,
  // 50K block range on eth_getLogs, friendly to ethers.js batching.
  // Used by getProvider() in lib/contract.ts (server-side fetch only).
  // NOT usable from the browser because the Canteen relay does not
  // return CORS headers — we keep it for /api routes only.
  rpc: 'https://rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_69d78a8fe4b1592488ffcf5b007e66fa9c5cda8baf4f3791bb7dec518258e097',
  // Public RPC: open CORS, usable from the browser via wagmi/viem.
  // Has the 10K block limit on eth_getLogs but that does not matter
  // for the client (the client only does simple eth_call / eth_getBalance
  // reads, no log queries).
  publicRpc: 'https://rpc.testnet.arc.network',
  rpcAlternates: [
    'https://rpc.testnet.arc.network',
    'https://rpc.blockdaemon.testnet.arc.network',
    'https://rpc.drpc.testnet.arc.network',
    'https://rpc.quicknode.testnet.arc.network',
  ],
  ws: 'wss://rpc.testnet.arc.network',
  explorer: 'https://testnet.arcscan.app',
  faucet: 'https://faucet.circle.com',
  nativeCurrency: {
    // Arc's gas token is USDC. On the native side, balances are denominated
    // in 18 decimals (so the EVM gas math stays standard). The ERC-20 USDC
    // contract on Arc uses the conventional 6 decimals. Both refer to the
    // same underlying balance, just expressed in two scales.
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  contracts: {
    // Circle native deployments on Arc testnet
    USDC: '0x3600000000000000000000000000000000000000',
    USYC: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
    EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    // USYC supporting contracts
    USYCEntitlements: '0xcc205224862c7641930c87679e98999d23c26113',
    USYCTeller: '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A',
    // Circle CCTP v2
    cctpTokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    cctpMessageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    // Circle Gateway
    gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
    // Common
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    // Bow V2 contracts (deployed 2026-05-18) — vault has lending pool
    // wiring so the AI operator can deploy idle USDC/USYC/EURC into
    // BowLendingPool and pull back for user withdraws.
    bowVault: '0x13260290cc0e655f34c7e87946a502a6f248e5cb',
    decisionLog: '0x0fBab34958b17099af962f615acA7F03C77291cE',
    tournamentVault: '0xC2ce20163Ce4eF95dFC32408aF2e18cB428763BA',
    // V1 archive (kept for reference, 34 USDC TVL stuck until users claim)
    bowVaultV1: '0x87107f7122FD12cB15740DfA292FffB0d7f180B2',
    decisionLogV1: '0xf547A123859C868fC42d720251B1DBdb59d2e5c9',
    tournamentVaultV1: '0xc64F830e8a38f9253649D318589c82a9A3b486CE',
    // BowAgentIdentity (ERC-8004 IdentityRegistry), deployed 2026-05-17
    // Agent registered as agentId #1, owned by the AI operator wallet.
    agentIdentity: '0x92e6b40da9566d6b7176420d88818500db77d122',
    // BowLendingPool, deployed 2026-05-18. Aave-style mock pool that
    // demonstrates the lending leg of the Bow strategy on Arc testnet
    // (where no production lending protocol is live yet). Reserves:
    // USDC 3.30% APR, USYC 0% (use native Circle yield), EURC 1.91% APR.
    // Rates mirror Aave V3 Ethereum mainnet supply via DefiLlama.
    lendingPool: '0xa4a9adf4a24ab16d16c426c7f6ab0f54ee8cc11d',
  },
} as const

export const ACTIVE_CHAIN = ARC_TESTNET

/// Three managed assets in the Bow vault. AI rebalances allocation across
/// these based on yield spread + FX state + recent track record.
export const ASSETS = {
  USDC: {
    address: ACTIVE_CHAIN.contracts.USDC,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6, // Arc native USDC is 18 decimals (unusual, normally 6)
    role: 'stable',
    description: 'Pure USD stable, also the gas token of Arc. No yield, zero slippage internal, maximum liquidity.',
  },
  USYC: {
    address: ACTIVE_CHAIN.contracts.USYC,
    symbol: 'USYC',
    name: 'Circle US Yield Coin',
    decimals: 6,
    role: 'tbill',
    description: 'Tokenized US Treasury Bills. Earns short-term T-bill yield (~3.5% APR), permissioned mint via Circle.',
  },
  EURC: {
    address: ACTIVE_CHAIN.contracts.EURC,
    symbol: 'EURC',
    name: 'Euro Coin',
    decimals: 6,
    role: 'fx',
    description: 'Euro-denominated stablecoin by Circle. Provides FX exposure to EUR vs USD spread.',
  },
} as const

export type AssetKey = keyof typeof ASSETS
