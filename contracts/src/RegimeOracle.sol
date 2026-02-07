// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RegimeOracle
 * @notice On-chain store for ML regime predictions AND realised volatility.
 *
 * The off-chain inference service pushes:
 *   - Regime probabilities (P(HIGH_VOL), P(LOW_VOL))
 *   - Shannon entropy
 *   - Realised 24h volatility (used for market resolution)
 *
 * Trust model (hackathon): single operator key pushes updates.
 */
contract RegimeOracle {
    // ─── State ───────────────────────────────────────────────────────────

    address public oracleOperator;
    bytes32 public registeredModelHash;

    struct RegimeUpdate {
        uint256 pHighVol;      // probability × 1e18
        uint256 pLowVol;       // probability × 1e18
        uint256 entropy;       // Shannon entropy × 1e18
        uint256 realisedVol;   // 24h realised volatility × 1e18
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
        uint256 realisedVol,
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
     * @notice Push a new regime probability update with realised volatility.
     * @param _pHigh       P(HIGH_VOL) scaled by 1e18
     * @param _pLow        P(LOW_VOL) scaled by 1e18
     * @param _entropy     Shannon entropy scaled by 1e18
     * @param _realisedVol Realised 24h volatility scaled by 1e18
     * @param _modelHash   sha256 of model weights file
     */
    function pushUpdate(
        uint256 _pHigh,
        uint256 _pLow,
        uint256 _entropy,
        uint256 _realisedVol,
        bytes32 _modelHash
    ) external onlyOperator {
        if (_modelHash != registeredModelHash) revert ModelMismatch();
        if (_pHigh + _pLow > 1e18 + 1e15) revert InvalidProbabilities();

        latestUpdate = RegimeUpdate({
            pHighVol: _pHigh,
            pLowVol: _pLow,
            entropy: _entropy,
            realisedVol: _realisedVol,
            timestamp: block.timestamp,
            modelHash: _modelHash
        });

        updateCount++;

        emit RegimeUpdated(updateCount, _pHigh, _pLow, _entropy, _realisedVol, block.timestamp);
    }

    // ─── Commit-reveal helpers ───────────────────────────────────────────

    function postCommit(bytes32 _commitHash) external onlyOperator {
        commits[_commitHash] = true;
        emit CommitPosted(_commitHash, block.number);
    }

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

    function getRealisedVol() external view returns (uint256) {
        return latestUpdate.realisedVol;
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
