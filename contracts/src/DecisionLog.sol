// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDecisionLog} from "./IDecisionLog.sol";

/// @title Bow DecisionLog — append-only on-chain reasoning record
/// @notice
///   Every AI allocation decision is recorded here. The reasoning text is
///   emitted as event data (calldata in the log topic) which keeps storage
///   cost down while remaining publicly indexable from the chain. Storage
///   keeps only the structured fields (allocations, confidence, timestamp,
///   reasoning hash). Decoders can re-fetch the reasoning text from event
///   logs and verify against the hash.
contract DecisionLog is IDecisionLog {
    error OnlyAgent();
    error AgentAlreadySet();

    event DecisionLogged(
        uint256 indexed id,
        address indexed agent,
        uint8 usdcPct,
        uint8 usycPct,
        uint8 eurcPct,
        uint8 confidence,
        bytes32 reasoningHash,
        string reasoning,
        uint64 timestamp
    );

    address public owner;
    address public agent; // the HybridVault, can write decisions

    struct Decision {
        uint8 usdcPct;
        uint8 usycPct;
        uint8 eurcPct;
        uint8 confidence;
        bytes32 reasoningHash;
        uint64 timestamp;
    }

    uint256 public totalDecisions;
    mapping(uint256 => Decision) public decisions;

    constructor() { owner = msg.sender; }

    function setAgent(address _agent) external {
        if (msg.sender != owner) revert();
        if (agent != address(0)) revert AgentAlreadySet();
        agent = _agent;
    }

    function logDecision(
        address /*caller*/,
        uint8 usdcPct,
        uint8 usycPct,
        uint8 eurcPct,
        uint8 confidence,
        string calldata reasoning
    ) external override returns (uint256 id) {
        if (msg.sender != agent) revert OnlyAgent();
        id = ++totalDecisions;
        bytes32 hash = keccak256(bytes(reasoning));
        decisions[id] = Decision({
            usdcPct: usdcPct,
            usycPct: usycPct,
            eurcPct: eurcPct,
            confidence: confidence,
            reasoningHash: hash,
            timestamp: uint64(block.timestamp)
        });
        emit DecisionLogged(id, msg.sender, usdcPct, usycPct, eurcPct, confidence, hash, reasoning, uint64(block.timestamp));
    }
}
