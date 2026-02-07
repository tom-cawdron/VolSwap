// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MultiverseMarket.sol";

/**
 * @title HedgeVault
 * @notice Users deposit ETH and choose a hedge ratio.
 *
 * The vault automatically buys HIGH_VOL tokens in the current round:
 *   - hedgeRatio% of the deposit → HIGH_VOL tokens via MultiverseMarket
 *   - Remainder stays as base ETH in the vault
 *
 * If volatility increases (HIGH_VOL wins the round), the hedge payout
 * offsets ETH drawdown — an on-chain regime-hedged portfolio.
 */
contract HedgeVault {
    // ─── State ───────────────────────────────────────────────────────────

    MultiverseMarket public market;

    struct Position {
        uint256 ethDeposited;      // base ETH held in vault
        uint256 hedgeRatio;        // bps (e.g. 2000 = 20%)
        uint256 depositTimestamp;
    }

    /// @notice Tracks which rounds a user has hedge tokens in
    struct RoundHedge {
        uint256 roundId;
        uint256 tokens;
    }

    mapping(address => Position) public positions;
    /// @notice user → list of round hedges (append-only, small for hackathon)
    mapping(address => RoundHedge[]) public userHedges;

    address[] public depositors;
    uint256 public totalDeposits;

    /// @notice Maximum hedge ratio: 30% (3000 bps)
    uint256 public constant MAX_HEDGE_RATIO = 3000;

    // ─── Events ──────────────────────────────────────────────────────────

    event Deposited(
        address indexed user,
        uint256 totalAmount,
        uint256 hedgeAmount,
        uint256 roundId,
        uint256 hedgeRatio
    );
    event Withdrawn(address indexed user, uint256 ethAmount);
    event HedgeClaimed(address indexed user, uint256 roundId, uint256 payout);

    // ─── Errors ──────────────────────────────────────────────────────────

    error HedgeRatioTooHigh();
    error NoPosition();
    error TransferFailed();
    error ZeroDeposit();
    error NoActiveRound();

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _market) {
        market = MultiverseMarket(payable(_market));
    }

    // ─── Deposit ─────────────────────────────────────────────────────────

    /**
     * @notice Deposit ETH with a chosen hedge ratio.
     *         The hedge portion buys HIGH_VOL tokens in the current round.
     * @param hedgeRatio Percentage of deposit for hedge (bps, e.g. 2000 = 20%)
     */
    function deposit(uint256 hedgeRatio) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        if (hedgeRatio > MAX_HEDGE_RATIO) revert HedgeRatioTooHigh();

        uint256 currentRound = market.currentRoundId();
        if (currentRound == 0) revert NoActiveRound();

        uint256 hedgeAmount = (msg.value * hedgeRatio) / 10_000;
        uint256 baseAmount = msg.value - hedgeAmount;

        if (hedgeAmount > 0) {
            // Buy HIGH_VOL tokens in the current round
            market.buyOutcome{value: hedgeAmount}(currentRound, true, hedgeAmount);

            // Record the hedge for this round
            userHedges[msg.sender].push(RoundHedge({
                roundId: currentRound,
                tokens: hedgeAmount
            }));
        }

        // Record position (additive)
        Position storage pos = positions[msg.sender];
        if (pos.ethDeposited == 0) {
            depositors.push(msg.sender);
        }
        pos.ethDeposited += baseAmount;
        pos.hedgeRatio = hedgeRatio;
        pos.depositTimestamp = block.timestamp;

        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, hedgeAmount, currentRound, hedgeRatio);
    }

    // ─── Withdraw ────────────────────────────────────────────────────────

    /**
     * @notice Withdraw base ETH position.
     */
    function withdrawBase() external {
        Position storage pos = positions[msg.sender];
        if (pos.ethDeposited == 0) revert NoPosition();

        uint256 amount = pos.ethDeposited;
        pos.ethDeposited = 0;
        totalDeposits -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim hedge payout for a specific resolved round.
     * @param hedgeIndex Index into the user's userHedges array
     */
    function claimHedge(uint256 hedgeIndex) external {
        RoundHedge[] storage hedges = userHedges[msg.sender];
        if (hedgeIndex >= hedges.length) revert NoPosition();

        RoundHedge storage hedge = hedges[hedgeIndex];
        if (hedge.tokens == 0) revert NoPosition();

        uint256 roundId = hedge.roundId;
        uint256 tokens = hedge.tokens;
        hedge.tokens = 0;

        // Claim from the market on behalf of the vault
        // Note: for hackathon the vault holds the tokens via the market's
        // balance mapping (address(this) is the buyer in deposit()).
        // In production this would use ERC-1155 transfers.

        // Get round info to calculate payout locally
        MultiverseMarket.Round memory round = market.getRound(roundId);
        uint256 payout = 0;

        if (round.resolved && round.highVolWon && round.totalHighTokens > 0) {
            payout = (tokens * round.totalCollateral) / round.totalHighTokens;
        }

        if (payout > 0 && payout <= address(this).balance) {
            (bool ok, ) = msg.sender.call{value: payout}("");
            if (!ok) revert TransferFailed();
        }

        emit HedgeClaimed(msg.sender, roundId, payout);
    }

    // ─── View helpers ────────────────────────────────────────────────────

    function getPosition(address user)
        external
        view
        returns (uint256 ethDeposited, uint256 hedgeRatio, uint256 depositTimestamp)
    {
        Position memory pos = positions[user];
        return (pos.ethDeposited, pos.hedgeRatio, pos.depositTimestamp);
    }

    function getUserHedgeCount(address user) external view returns (uint256) {
        return userHedges[user].length;
    }

    function getUserHedge(address user, uint256 index) external view returns (uint256 roundId, uint256 tokens) {
        RoundHedge memory h = userHedges[user][index];
        return (h.roundId, h.tokens);
    }

    function depositorCount() external view returns (uint256) {
        return depositors.length;
    }

    // ─── Receive ETH (for market payouts) ────────────────────────────────

    receive() external payable {}
}
