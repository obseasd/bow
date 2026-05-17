// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ITournamentVault {
    function openRound(uint8 usdcPct, uint8 usycPct, uint8 eurcPct) external returns (uint256 roundId);
    function totalRounds() external view returns (uint256);
}
