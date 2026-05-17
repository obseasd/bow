// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Bow Agent Identity (ERC-8004 Identity Registry)
/// @notice Minimal compliant implementation of the ERC-8004 IdentityRegistry
///         interface for the Bow AI treasury agent on Mantle Mainnet.
///         Lets the Bow agent be discoverable and composable as a first-class
///         on-chain identity per the standard
///         (https://eips.ethereum.org/EIPS/eip-8004).
/// @dev    ERC-721 URIStorage as required by the spec, plus the registry
///         functions, events, and metadata storage. setAgentWallet with EIP-712
///         signatures is omitted for the MVP — ownership transfer via standard
///         ERC-721 transfer is sufficient for our needs.
// Note: "BowAgentIdentity" replaces the original "MensaAgentIdentity"
// contract from sister repo github.com/obseasd/mensa. Same code, branded
// for the Bow-on-Arc deployment and its own NFT name/symbol.
contract BowAgentIdentity is ERC721URIStorage, Ownable {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    uint256 private _nextId;
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    error NotAgentOwner();
    error AgentDoesNotExist();

    constructor() ERC721("Bow Agent Identity", "BAID") Ownable(msg.sender) {}

    /// @notice Register a new agent identity NFT pointing to an off-chain agent
    ///         card, with an initial set of metadata entries.
    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        returns (uint256 agentId)
    {
        agentId = ++_nextId;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
        emit Registered(agentId, agentURI, msg.sender);
        for (uint256 i = 0; i < metadata.length; i++) {
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(
                agentId,
                metadata[i].metadataKey,
                metadata[i].metadataKey,
                metadata[i].metadataValue
            );
        }
    }

    /// @notice Register with just the agent card URI, no metadata entries.
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = ++_nextId;
        _safeMint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);
        emit Registered(agentId, agentURI, msg.sender);
    }

    /// @notice Register an empty identity that the owner can fill in later.
    function register() external returns (uint256 agentId) {
        agentId = ++_nextId;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, "", msg.sender);
    }

    /// @notice Update the agent card URI. Only the current NFT owner can call.
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (_ownerOf(agentId) == address(0)) revert AgentDoesNotExist();
        if (_ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue)
        external
    {
        if (_ownerOf(agentId) == address(0)) revert AgentDoesNotExist();
        if (_ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    function getMetadata(uint256 agentId, string memory metadataKey)
        external
        view
        returns (bytes memory)
    {
        return _metadata[agentId][metadataKey];
    }

    /// @notice Wallet associated with an agent. For this MVP we equate it to
    ///         the current NFT owner (standard transfer = wallet rotation).
    function getAgentWallet(uint256 agentId) external view returns (address) {
        address o = _ownerOf(agentId);
        if (o == address(0)) revert AgentDoesNotExist();
        return o;
    }

    function totalAgents() external view returns (uint256) {
        return _nextId;
    }
}
