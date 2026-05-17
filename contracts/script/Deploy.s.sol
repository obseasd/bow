// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/HybridVault.sol";
import "../src/DecisionLog.sol";
import "../src/TournamentVault.sol";

/// @notice Deploy the Bow stack on Arc testnet.
///   Set ARC_AI_OPERATOR in env to the wallet that will sign agent
///   transactions. The deployer becomes the owner of all three contracts.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address aiOperator = vm.envAddress("ARC_AI_OPERATOR");

        // Arc testnet addresses (Circle native)
        address USDC = 0x3600000000000000000000000000000000000000;
        address USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
        address EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

        vm.startBroadcast(pk);

        // Deploy in this order: DecisionLog -> HybridVault -> TournamentVault
        DecisionLog log = new DecisionLog();
        HybridVault vault = new HybridVault(USDC, USYC, EURC, aiOperator);
        TournamentVault tournament = new TournamentVault(address(vault), aiOperator);

        // Wire vault to log + tournament
        log.setAgent(address(vault));
        vault.setDecisionLog(address(log));
        vault.setTournament(address(tournament));

        vm.stopBroadcast();

        console.log("=== Bow deployment on Arc testnet ===");
        console.log("DecisionLog     :", address(log));
        console.log("HybridVault     :", address(vault));
        console.log("TournamentVault :", address(tournament));
        console.log("AI operator     :", aiOperator);
    }
}
