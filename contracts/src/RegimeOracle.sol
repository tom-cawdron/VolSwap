// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RegimeOracle
 * @notice On-chain store for ML regime probability updates.
 *
 * The off-chain inference service pushes regime probabilities here.
 * Other contracts (MultiverseMarket, HedgeVault) read from this oracle.
 *
 * Trust model (hackathon):
 *   - Single operator key pushes updates.
 *   - Model hash is registered at deployment; mismatches are rejected.
 *
 * Production roadmap:
 *   - Commit-reveal scheme for tamper-proofing.
 *   - Chainlink Functions / Ritual Network for decentralised inference.
 *   - ZK proof of inference (EZKL).
 */
contract RegimeOracle {
    // ─── State ───────────────────────────────────────────────────────────

    address public oracleOperator;
    bytes32 public registeredModelHash;

    struct RegimeUpdate {
        uint256 pHighVol;   // probability × 1e18  (e.g. 0.73 → 73e16)
        uint256 pLowVol;    // probability × 1e18
        uint256 entropy;    // Shannon entropy × 1e18
        uint256 timestamp;
        bytes32 modelHash;
    }

    RegimeUpdate public latestUpdate;
    uint256 public updateCount;

    // Commit-reveal (optional tamper-proofing)
    mapping(bytes32 => bool) public commits;

    // ─── Events ──────────────────────────────────────────────────────────

    event RegimeUpdated(
        uint256 indexed updateId,
        uint256 pHighVol,
        uint256 pLowVol,
        uint256 entropy,
        uint256 timestamp
    );
    event CommitPosted(bytes32 indexed commitHash, uint256 blockNumber);
    event OperatorTransferred(address indexed oldOperator, address indexed newOperator);

    // ─── Errors ──────────────────────────────────────────────────────────

    error Unauthorized();
    error ModelMismatch();
    error InvalidProbabilities();

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != oracleOperator) revert Unauthorized();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(bytes32 _modelHash) {
        oracleOperator = msg.sender;
        registeredModelHash = _modelHash;
    }

    // ─── Core functions ──────────────────────────────────────────────────

    /**
     * @notice Push a new regime probability update.
     * @param _pHigh  P(HIGH_VOL) scaled by 1e18
     * @param _pLow   P(LOW_VOL)  scaled by 1e18
     * @param _entropy Shannon entropy scaled by 1e18
     * @param _modelHash keccak256 of model weights file
     */
    function pushUpdate(
        uint256 _pHigh,
        uint256 _pLow,
        uint256 _entropy,
        bytes32 _modelHash
    ) external onlyOperator {
        if (_modelHash != registeredModelHash) revert ModelMismatch();
        // Allow small rounding tolerance (1e15 ≈ 0.1%)
        if (_pHigh + _pLow > 1e18 + 1e15) revert InvalidProbabilities();

        latestUpdate = RegimeUpdate({
            pHighVol: _pHigh,
            pLowVol: _pLow,
            entropy: _entropy,
            timestamp: block.timestamp,
            modelHash: _modelHash
        });

        updateCount++;

        emit RegimeUpdated(updateCount, _pHigh, _pLow, _entropy, block.timestamp);
    }

    // ─── Commit-reveal helpers ───────────────────────────────────────────

    /**
     * @notice Post a commitment hash before revealing the update.
     * @param _commitHash keccak256(abi.encodePacked(pHigh, pLow, entropy, nonce))
     */
    function postCommit(bytes32 _commitHash) external onlyOperator {
        commits[_commitHash] = true;
        emit CommitPosted(_commitHash, block.number);
    }

    /**
     * @notice Verify that a commit was posted (for off-chain verification).
     */
    function verifyCommit(bytes32 _commitHash) external view returns (bool) {
        return commits[_commitHash];
    }

    // ─── View helpers ────────────────────────────────────────────────────

    function getRegimeProbs() external view returns (uint256 pHigh, uint256 pLow) {
        return (latestUpdate.pHighVol, latestUpdate.pLowVol);
    }

    function getEntropy() external view returns (uint256) {
        return latestUpdate.entropy;
    }

    function isStale(uint256 maxAge) external view returns (bool) {
        return block.timestamp - latestUpdate.timestamp > maxAge;
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function transferOperator(address _newOperator) external onlyOperator {
        emit OperatorTransferred(oracleOperator, _newOperator);
        oracleOperator = _newOperator;
    }

    function updateModelHash(bytes32 _newHash) external onlyOperator {
        registeredModelHash = _newHash;
    }
}
