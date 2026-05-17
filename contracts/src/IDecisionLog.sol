// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDecisionLog {
    function logDecision(
        address agent,
        uint8 usdcPct,
        uint8 usycPct,
        uint8 eurcPct,
        uint8 confidence,
        string calldata reasoning
    ) external returns (uint256 decisionId);
}
