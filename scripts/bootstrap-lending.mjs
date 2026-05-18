#!/usr/bin/env node
// Bootstrap the BowLendingPool with a small USDC supply so the live
// state is non-empty for judges. Uses the AI operator wallet.
//
// Usage:
//   PRIVATE_KEY=0x... node scripts/bootstrap-lending.mjs

import { ethers } from 'ethers'

const RPC = 'https://rpc.testnet.arc.network'
const POOL = '0xa4a9adf4a24ab16d16c426c7f6ab0f54ee8cc11d'
const USDC = '0x3600000000000000000000000000000000000000'
const AMOUNT = ethers.parseUnits('2', 6) // 2 USDC

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
]

const POOL_ABI = [
  'function supply(address asset, uint256 amount) external',
  'function balanceOf(address user, address asset) view returns (uint256)',
  'function getReserveInfo(address asset) view returns (bool, uint256, uint256)',
]

async function main() {
  const pk = (process.env.PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '')
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('PRIVATE_KEY missing or malformed')
    process.exit(1)
  }
  const provider = new ethers.JsonRpcProvider(RPC)
  const wallet = new ethers.Wallet(pk, provider)
  const usdc = new ethers.Contract(USDC, ERC20, wallet)
  const pool = new ethers.Contract(POOL, POOL_ABI, wallet)

  console.log('Wallet :', wallet.address)
  console.log('Pool   :', POOL)

  const bal = await usdc.balanceOf(wallet.address)
  console.log('USDC balance :', ethers.formatUnits(bal, 6))
  if (bal < AMOUNT) {
    console.error('Insufficient USDC balance for 2 USDC bootstrap supply.')
    process.exit(1)
  }

  const allowance = await usdc.allowance(wallet.address, POOL)
  if (allowance < AMOUNT) {
    console.log('Approving 2 USDC...')
    const a = await usdc.approve(POOL, AMOUNT)
    console.log('  tx:', a.hash)
    await a.wait()
    console.log('  confirmed.')
  }

  console.log('Supplying 2 USDC to pool...')
  const s = await pool.supply(USDC, AMOUNT)
  console.log('  tx:', s.hash)
  await s.wait()
  console.log('  confirmed.')

  const myBal = await pool.balanceOf(wallet.address, USDC)
  console.log()
  console.log('=== Pool state after supply ===')
  console.log('My USDC supply position (with accrued interest as of now):',
    ethers.formatUnits(myBal, 6), 'USDC')
  const [accepted, aprBps, totalSupplied] = await pool.getReserveInfo(USDC)
  console.log('Reserve USDC: accepted=' + accepted + ' aprBps=' + aprBps + ' totalSupplied=' + ethers.formatUnits(totalSupplied, 6))
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
