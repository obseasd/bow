// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/HybridVaultV2.sol";
import "../src/DecisionLog.sol";
import "../src/TournamentVault.sol";

/// @notice Deploy the V2 Bow stack on Arc testnet. V2 adds lending
///         control on top of V1 (HybridVault). The existing BowLendingPool
///         deployed at 0xa4a9adf4a24ab16d16c426c7f6ab0f54ee8cc11d is wired
///         in so the new vault can supply / withdraw from it.
///
///         New DecisionLog and TournamentVault contracts are deployed
///         because the existing instances are locked to the V1 vault as
///         their agent (setAgent uses a one-shot pattern).
contract DeployV2 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address aiOperator = vm.envOr("ARC_AI_OPERATOR", vm.addr(pk));

        // Arc testnet addresses (Circle native)
        address USDC = 0x3600000000000000000000000000000000000000;
        address USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
        address EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

        // Existing BowLendingPool (already configured with USDC/USYC/EURC reserves)
        address LENDING_POOL = 0xA4a9ADf4A24Ab16D16c426c7f6Ab0f54eE8cc11D;

        vm.startBroadcast(pk);

        DecisionLog log = new DecisionLog();
        HybridVaultV2 vault = new HybridVaultV2(USDC, USYC, EURC, aiOperator);
        TournamentVault tournament = new TournamentVault(address(vault), aiOperator);

        log.setAgent(address(vault));
        vault.setDecisionLog(address(log));
        vault.setTournament(address(tournament));
        vault.setLendingPool(LENDING_POOL);

        vm.stopBroadcast();

        console.log("=== Bow V2 deployment on Arc testnet ===");
        console.log("HybridVaultV2   :", address(vault));
        console.log("DecisionLog (v2):", address(log));
        console.log("TournamentVault (v2):", address(tournament));
        console.log("LendingPool (existing):", LENDING_POOL);
        console.log("AI operator     :", aiOperator);
    }
}
