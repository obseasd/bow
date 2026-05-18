import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { ARC_TESTNET } from './chains'

// The browser-side RPC must allow CORS. The Canteen-issued personal RPC
// (used server-side in lib/contract.ts) does not return CORS headers, so
// we use the public Arc RPC here for every wagmi/viem call from the
// browser (wallet connect, contract reads, writes).
const BROWSER_RPC = ARC_TESTNET.publicRpc

export const arcTestnet = defineChain({
  id: ARC_TESTNET.id,
  name: ARC_TESTNET.name,
  nativeCurrency: ARC_TESTNET.nativeCurrency,
  rpcUrls: {
    default: { http: [BROWSER_RPC] },
    public: { http: [BROWSER_RPC] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: ARC_TESTNET.explorer },
  },
  testnet: true,
})

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(BROWSER_RPC),
  },
})
