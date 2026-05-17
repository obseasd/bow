// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/BowAgentIdentity.sol";

/// @notice Deploy the ERC-8004 IdentityRegistry for Bow on Arc testnet,
///         then register the Bow agent with agentId = 1.
contract DeployIdentity is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address aiOperator = vm.envOr("ARC_AI_OPERATOR", vm.addr(pk));

        vm.startBroadcast(pk);

        BowAgentIdentity identity = new BowAgentIdentity();

        // Register the Bow agent as #1, with agentURI pointing at the
        // public agent card endpoint. Metadata entries are minimal at
        // mint, can be added later with setMetadata.
        BowAgentIdentity.MetadataEntry[] memory metadata = new BowAgentIdentity.MetadataEntry[](2);
        metadata[0] = BowAgentIdentity.MetadataEntry({
            metadataKey: "model",
            metadataValue: bytes("claude-haiku-4-5")
        });
        metadata[1] = BowAgentIdentity.MetadataEntry({
            metadataKey: "bowVault",
            metadataValue: abi.encodePacked(uint160(0x87107f7122FD12cB15740DfA292FffB0d7f180B2))
        });
        uint256 agentId = identity.register(
            "https://bow-gamma.vercel.app/api/agent-card",
            metadata
        );

        vm.stopBroadcast();

        console.log("=== Bow ERC-8004 IdentityRegistry deployed on Arc testnet ===");
        console.log("BowAgentIdentity :", address(identity));
        console.log("Agent registered :", agentId);
        console.log("Agent operator   :", aiOperator);
        console.log("Card URI         : https://bow-gamma.vercel.app/api/agent-card");
    }
}
