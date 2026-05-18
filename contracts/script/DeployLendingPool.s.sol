// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/BowLendingPool.sol";

/// @notice Deploy BowLendingPool on Arc testnet, configure USDC + USYC +
///         EURC reserves with their target APRs (sourced from DefiLlama's
///         Aave V3 Ethereum mainnet supply rates as benchmarks).
contract DeployLendingPool is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        address USDC = 0x3600000000000000000000000000000000000000;
        address USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
        address EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

        vm.startBroadcast(pk);

        BowLendingPool pool = new BowLendingPool();

        // Configure each reserve. USYC has its own native Circle yield
        // so we set its pool APR to 0 here — supplying USYC into Bow's
        // lending pool gives no extra yield, you stay with the asset's
        // native accrual.
        pool.setReserve(USDC, true, 330); // 3.30% APR, Aave V3 mainnet supply
        pool.setReserve(USYC, true, 0);   // 0% in-pool; USYC accrues natively
        pool.setReserve(EURC, true, 191); // 1.91% APR, Aave V3 mainnet supply

        vm.stopBroadcast();

        console.log("=== BowLendingPool deployed on Arc testnet ===");
        console.log("Pool address  :", address(pool));
        console.log("USDC accepted at 3.30% APR");
        console.log("USYC accepted at 0.00% APR (use native Circle yield instead)");
        console.log("EURC accepted at 1.91% APR");
    }
}
