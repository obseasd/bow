import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { ARC_TESTNET } from './chains'

export const arcTestnet = defineChain({
  id: ARC_TESTNET.id,
  name: ARC_TESTNET.name,
  nativeCurrency: ARC_TESTNET.nativeCurrency,
  rpcUrls: {
    default: { http: [ARC_TESTNET.rpc] },
    public: { http: [ARC_TESTNET.rpc] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: ARC_TESTNET.explorer },
  },
  testnet: true,
})

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(ARC_TESTNET.rpc),
  },
})
