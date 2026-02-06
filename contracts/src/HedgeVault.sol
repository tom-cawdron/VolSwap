// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MultiverseMarket.sol";

/**
 * @title HedgeVault
 * @notice Users deposit ETH and choose a hedge ratio.
 *
 * The vault automatically buys HIGH_VOL tokens as insurance:
 *   - hedgeRatio% of the deposit → HIGH_VOL tokens via MultiverseMarket
 *   - Remainder stays as base ETH position
 *
 * If a high-vol regime materialises, the HIGH_VOL tokens pay out,
 * offsetting ETH drawdown — an on-chain regime-hedged portfolio.
 *
 * Stretch goal: regime-conditional yield (earn AMM fees during LOW_VOL,
 * auto-shift to hedge mode when model flips to HIGH_VOL).
 */
contract HedgeVault {
    // ─── State ───────────────────────────────────────────────────────────

    MultiverseMarket public market;

    struct Position {
        uint256 ethDeposited;      // base ETH held in vault
        uint256 highVolTokens;     // hedge tokens purchased
        uint256 hedgeRatio;        // bps (e.g. 2000 = 20%)
        uint256 depositTimestamp;
    }

    mapping(address => Position) public positions;
    address[] public depositors;
    uint256 public totalDeposits;

    /// @notice Maximum hedge ratio: 30% (3000 bps)
    uint256 public constant MAX_HEDGE_RATIO = 3000;

    // ─── Events ──────────────────────────────────────────────────────────

    event Deposited(
        address indexed user,
        uint256 totalAmount,
        uint256 hedgeAmount,
        uint256 highVolTokens,
        uint256 hedgeRatio
    );
    event Withdrawn(address indexed user, uint256 ethAmount, uint256 hedgeTokens);
    event HedgeClaimed(address indexed user, uint256 payout);

    // ─── Errors ──────────────────────────────────────────────────────────

    error HedgeRatioTooHigh();
    error NoPosition();
    error TransferFailed();
    error ZeroDeposit();

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _market) {
        market = MultiverseMarket(payable(_market));
    }

    // ─── Deposit ─────────────────────────────────────────────────────────

    /**
     * @notice Deposit ETH with a chosen hedge ratio.
     * @param hedgeRatio Percentage of deposit allocated to HIGH_VOL hedge (bps).
     *                   e.g. 2000 = 20% of deposit buys HIGH_VOL tokens.
     */
    function deposit(uint256 hedgeRatio) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        if (hedgeRatio > MAX_HEDGE_RATIO) revert HedgeRatioTooHigh();

        uint256 hedgeAmount = (msg.value * hedgeRatio) / 10_000;
        uint256 baseAmount = msg.value - hedgeAmount;

        uint256 tokensBought = 0;
        if (hedgeAmount > 0) {
            // Buy HIGH_VOL tokens through the market
            tokensBought = market.buyOutcome{value: hedgeAmount}(true, hedgeAmount);
        }

        // Record position (additive if user deposits again)
        Position storage pos = positions[msg.sender];
        if (pos.ethDeposited == 0 && pos.highVolTokens == 0) {
            depositors.push(msg.sender);
        }
        pos.ethDeposited += baseAmount;
        pos.highVolTokens += tokensBought;
        pos.hedgeRatio = hedgeRatio;
        pos.depositTimestamp = block.timestamp;

        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, hedgeAmount, tokensBought, hedgeRatio);
    }

    // ─── Withdraw ────────────────────────────────────────────────────────

    /**
     * @notice Withdraw base ETH position.
     * @dev Hedge tokens remain until the market resolves and user claims.
     */
    function withdrawBase() external {
        Position storage pos = positions[msg.sender];
        if (pos.ethDeposited == 0) revert NoPosition();

        uint256 amount = pos.ethDeposited;
        pos.ethDeposited = 0;
        totalDeposits -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, pos.highVolTokens);
    }

    /**
     * @notice Claim hedge payout after the market resolves (if HIGH_VOL won).
     */
    function claimHedge() external {
        Position storage pos = positions[msg.sender];
        if (pos.highVolTokens == 0) revert NoPosition();

        // The market's claimPayout will send ETH back to this vault,
        // which we then forward to the user.
        // For hackathon: simplified — user claims directly from market.
        // In production, vault would hold tokens and claim on behalf.

        uint256 tokens = pos.highVolTokens;
        pos.highVolTokens = 0;

        emit HedgeClaimed(msg.sender, tokens);
    }

    // ─── View helpers ────────────────────────────────────────────────────

    function getPosition(address user)
        external
        view
        returns (
            uint256 ethDeposited,
            uint256 highVolTokens,
            uint256 hedgeRatio,
            uint256 depositTimestamp
        )
    {
        Position memory pos = positions[user];
        return (pos.ethDeposited, pos.highVolTokens, pos.hedgeRatio, pos.depositTimestamp);
    }

    function depositorCount() external view returns (uint256) {
        return depositors.length;
    }

    // ─── Receive ETH (for market payouts) ────────────────────────────────

    receive() external payable {}
}
