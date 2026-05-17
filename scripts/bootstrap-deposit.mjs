#!/usr/bin/env node
// One-shot bootstrap script: deposit 5 USDC into the Bow vault from the
// AI operator wallet so the vault has visible TVL for the demo. Without
// this, /api/onchain returns TVL = 0 and the StatsBar shows $0, which
// looks dead even though the contracts are healthy.
//
// Usage:
//   PRIVATE_KEY=0x... node scripts/bootstrap-deposit.mjs

import { ethers } from 'ethers'

const RPC = 'https://rpc.testnet.arc.network'
const VAULT = '0x87107f7122FD12cB15740DfA292FffB0d7f180B2'
const USDC = '0x3600000000000000000000000000000000000000'

const AMOUNT = ethers.parseUnits('5', 6) // 5 USDC, Arc USDC ERC-20 is 6 decimals

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
]

const VAULT_ABI = [
  'function deposit(address asset, uint256 amount) returns (uint256)',
  'function totalShares() view returns (uint256)',
  'function totalAssetsUsd() view returns (uint256)',
  'function shareBalance(address) view returns (uint256)',
]

async function main() {
  const pk = (process.env.PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '')
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('PRIVATE_KEY missing or malformed')
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(RPC)
  const wallet = new ethers.Wallet(pk, provider)
  const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)
  const vault = new ethers.Contract(VAULT, VAULT_ABI, wallet)

  console.log('Wallet :', wallet.address)
  console.log('Vault  :', VAULT)
  console.log('Amount :', ethers.formatUnits(AMOUNT, 6), 'USDC')

  const balance = await usdc.balanceOf(wallet.address)
  console.log('USDC balance :', ethers.formatUnits(balance, 6))
  if (balance < AMOUNT) {
    console.error('Insufficient USDC balance.')
    process.exit(1)
  }

  // Approve
  const currentAllowance = await usdc.allowance(wallet.address, VAULT)
  if (currentAllowance < AMOUNT) {
    console.log('Approving...')
    const approveTx = await usdc.approve(VAULT, AMOUNT)
    console.log('  tx:', approveTx.hash)
    await approveTx.wait()
    console.log('  confirmed.')
  } else {
    console.log('Allowance already sufficient, skipping approve.')
  }

  // Deposit
  console.log('Depositing...')
  const depTx = await vault.deposit(USDC, AMOUNT)
  console.log('  tx:', depTx.hash)
  await depTx.wait()
  console.log('  confirmed.')

  // Report state
  const [totalShares, totalAssets, userShares] = await Promise.all([
    vault.totalShares(),
    vault.totalAssetsUsd(),
    vault.shareBalance(wallet.address),
  ])
  console.log()
  console.log('=== Vault state after deposit ===')
  console.log('Total shares      :', ethers.formatUnits(totalShares, 6))
  console.log('Total assets USD  :', ethers.formatUnits(totalAssets, 6))
  console.log('Your shares       :', ethers.formatUnits(userShares, 6))
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
