// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RegimeOracle.sol";

/**
 * @title MultiverseMarket
 * @notice LMSR-based AMM for binary regime tokens (HIGH_VOL / LOW_VOL).
 *
 * Pricing follows the Logarithmic Market Scoring Rule:
 *   Cost(q) = b · ln(exp(q_high/b) + exp(q_low/b))
 *   Price(HIGH_VOL) = exp(q_high/b) / (exp(q_high/b) + exp(q_low/b))
 *
 * Key innovation: **Entropy-adaptive fees**.
 *   - Fee scales with Shannon entropy of the oracle's regime output.
 *   - High entropy (uncertain) → wider spread (up to 5%) to protect LPs.
 *   - Low entropy (confident) → tighter spread (0.5%) to reward trading.
 */
contract MultiverseMarket {
    // ─── State ───────────────────────────────────────────────────────────

    RegimeOracle public oracle;

    /// @notice LMSR liquidity parameter (higher = deeper liquidity, lower sensitivity)
    uint256 public b;

    /// @notice Outstanding quantities of each outcome token (scaled 1e18)
    int256 public qHigh;
    int256 public qLow;

    /// @notice Token balances: user → outcome → amount
    mapping(address => uint256) public highVolBalance;
    mapping(address => uint256) public lowVolBalance;

    /// @notice Total collateral held by the market
    uint256 public totalCollateral;

    /// @notice Whether the market has been resolved
    bool public resolved;
    bool public highVolWon;

    /// @notice Resolution threshold — if oracle P(HighVol) > this, HIGH wins
    uint256 public constant RESOLUTION_THRESHOLD = 6e17; // 0.60

    /// @notice Maximum entropy for fee calculation: ln(2) ≈ 0.6931 (scaled 1e18)
    uint256 public constant MAX_ENTROPY = 693147180559945309;

    /// @notice Fee bounds (scaled 1e18): 0.5% to 5%
    uint256 public constant MIN_FEE = 5e15;   // 0.005
    uint256 public constant MAX_FEE = 50e15;  // 0.050

    // ─── Events ──────────────────────────────────────────────────────────

    event OutcomeBought(
        address indexed buyer,
        bool isHighVol,
        uint256 amount,
        uint256 cost,
        uint256 fee
    );
    event OutcomeSold(
        address indexed seller,
        bool isHighVol,
        uint256 amount,
        uint256 payout
    );
    event MarketResolved(bool highVolWon, uint256 timestamp);
    event Claimed(address indexed user, uint256 payout);

    // ─── Errors ──────────────────────────────────────────────────────────

    error MarketAlreadyResolved();
    error MarketNotResolved();
    error InsufficientPayment();
    error InsufficientBalance();
    error TransferFailed();

    // ─── Constructor ─────────────────────────────────────────────────────

    /**
     * @param _oracle  Address of the RegimeOracle contract
     * @param _b       LMSR liquidity parameter (e.g. 100e18)
     */
    constructor(address _oracle, uint256 _b) {
        oracle = RegimeOracle(_oracle);
        b = _b;
    }

    // ─── LMSR Math (fixed-point, 1e18 scale) ────────────────────────────

    /**
     * @notice Approximate exp(x/b) using a Taylor series.
     * @dev Good enough for hackathon demo.  Production should use PRBMath or ABDKMath.
     *
     * We compute exp(x * 1e18 / b) in 1e18 fixed point.
     * For safety we clamp the exponent.
     */
    function _expScaled(int256 q) internal view returns (uint256) {
        // exponent = q * 1e18 / b  (but q and b are already 1e18-scaled)
        // simplify: exponent = q / int256(b)
        int256 exponent = (q * 1e18) / int256(b);

        // Clamp to avoid overflow: exp(20) ≈ 4.8e8, safe in uint256
        if (exponent > 20e18) exponent = 20e18;
        if (exponent < -20e18) return 1; // exp(-20) ≈ 0

        // Taylor expansion: 1 + x + x²/2 + x³/6 + x⁴/24
        // All in 1e18 fixed point
        int256 x = exponent;
        int256 ONE = 1e18;
        int256 result = ONE;
        int256 term = x;
        result += term;
        term = (term * x) / (2 * ONE);
        result += term;
        term = (term * x) / (3 * ONE);
        result += term;
        term = (term * x) / (4 * ONE);
        result += term;
        term = (term * x) / (5 * ONE);
        result += term;
        term = (term * x) / (6 * ONE);
        result += term;

        return result > 0 ? uint256(result) : 1;
    }

    /**
     * @notice LMSR cost function: C(q) = b · ln(exp(qH/b) + exp(qL/b))
     * @dev Returns cost in 1e18 scale.
     */
    function _cost(int256 _qH, int256 _qL) internal view returns (uint256) {
        uint256 expH = _expScaled(_qH);
        uint256 expL = _expScaled(_qL);
        uint256 sumExp = expH + expL;

        // ln(sumExp) via simple approximation — ln(x) ≈ (x-1) - (x-1)²/2 + ...
        // For hackathon we use a piecewise log approximation
        uint256 logVal = _ln(sumExp);

        return (b * logVal) / 1e18;
    }

    /**
     * @notice Natural log approximation in 1e18 fixed point.
     * @dev Uses the identity: ln(x) = ln(x/2^k) + k·ln2, normalising x to [1,2).
     */
    function _ln(uint256 x) internal pure returns (uint256) {
        if (x <= 1e18) return 0;

        uint256 result = 0;
        uint256 LN2 = 693147180559945309; // ln(2) * 1e18

        // Normalise: divide by 2 until x < 2e18
        while (x >= 2e18) {
            x = x / 2;
            result += LN2;
        }

        // Now x is in [1e18, 2e18). Use Taylor: ln(1+y) ≈ y - y²/2 + y³/3
        uint256 y = x - 1e18; // y in [0, 1e18)
        uint256 ONE = 1e18;
        uint256 yPow = y;
        result += yPow;                            // + y
        yPow = (yPow * y) / ONE;
        result -= yPow / 2;                        // - y²/2
        yPow = (yPow * y) / ONE;
        result += yPow / 3;                        // + y³/3
        yPow = (yPow * y) / ONE;
        result -= yPow / 4;                        // - y⁴/4

        return result;
    }

    // ─── Dynamic Fee ─────────────────────────────────────────────────────

    /**
     * @notice Entropy-adaptive trading fee.
     * @return fee scaled by 1e18 (e.g. 5e15 = 0.5%)
     *
     * fee = MIN_FEE + (MAX_FEE - MIN_FEE) × (entropy / MAX_ENTROPY)
     */
    function dynamicFee() public view returns (uint256) {
        uint256 entropy = oracle.getEntropy();
        if (entropy >= MAX_ENTROPY) return MAX_FEE;
        uint256 fee = MIN_FEE + ((MAX_FEE - MIN_FEE) * entropy) / MAX_ENTROPY;
        return fee;
    }

    // ─── Price Queries ───────────────────────────────────────────────────

    /**
     * @notice Current LMSR price of the HIGH_VOL token.
     * @return price in 1e18 scale (e.g. 7e17 = 0.70)
     */
    function priceHighVol() external view returns (uint256) {
        uint256 expH = _expScaled(qHigh);
        uint256 expL = _expScaled(qLow);
        return (expH * 1e18) / (expH + expL);
    }

    /**
     * @notice Current LMSR price of the LOW_VOL token.
     */
    function priceLowVol() external view returns (uint256) {
        uint256 expH = _expScaled(qHigh);
        uint256 expL = _expScaled(qLow);
        return (expL * 1e18) / (expH + expL);
    }

    // ─── Trading ─────────────────────────────────────────────────────────

    /**
     * @notice Buy outcome tokens for a given regime.
     * @param isHighVol  true = buy HIGH_VOL tokens, false = buy LOW_VOL
     * @param amount     Number of tokens to buy (1e18 scale)
     */
    function buyOutcome(bool isHighVol, uint256 amount) external payable returns (uint256) {
        if (resolved) revert MarketAlreadyResolved();

        // Snapshot current cost
        uint256 costBefore = _cost(qHigh, qLow);

        // Update quantities
        if (isHighVol) {
            qHigh += int256(amount);
        } else {
            qLow += int256(amount);
        }

        uint256 costAfter = _cost(qHigh, qLow);
        uint256 rawCost = costAfter > costBefore ? costAfter - costBefore : 0;

        // Apply dynamic fee
        uint256 fee = (rawCost * dynamicFee()) / 1e18;
        uint256 totalCost = rawCost + fee;

        if (msg.value < totalCost) revert InsufficientPayment();

        // Credit tokens
        if (isHighVol) {
            highVolBalance[msg.sender] += amount;
        } else {
            lowVolBalance[msg.sender] += amount;
        }

        totalCollateral += totalCost;

        // Refund excess
        if (msg.value > totalCost) {
            (bool ok, ) = msg.sender.call{value: msg.value - totalCost}("");
            if (!ok) revert TransferFailed();
        }

        emit OutcomeBought(msg.sender, isHighVol, amount, rawCost, fee);
        return totalCost;
    }

    // ─── Resolution ──────────────────────────────────────────────────────

    /**
     * @notice Resolve the market based on the oracle's latest regime update.
     * @dev Anyone can call once conditions are met.
     *      HIGH_VOL wins if oracle P(HighVol) > RESOLUTION_THRESHOLD.
     */
    function resolveMarket() external {
        if (resolved) revert MarketAlreadyResolved();

        (uint256 pHigh, ) = oracle.getRegimeProbs();
        highVolWon = pHigh > RESOLUTION_THRESHOLD;
        resolved = true;

        emit MarketResolved(highVolWon, block.timestamp);
    }

    /**
     * @notice Claim payout after market resolution.
     */
    function claimPayout() external {
        if (!resolved) revert MarketNotResolved();

        uint256 winningTokens;
        if (highVolWon) {
            winningTokens = highVolBalance[msg.sender];
            highVolBalance[msg.sender] = 0;
        } else {
            winningTokens = lowVolBalance[msg.sender];
            lowVolBalance[msg.sender] = 0;
        }

        if (winningTokens == 0) revert InsufficientBalance();

        // Payout = tokens × (totalCollateral / totalWinningTokens)
        // Simplified: payout proportional to share of winning tokens
        // For hackathon demo, 1 winning token = 1 ETH unit payout
        uint256 payout = winningTokens;
        if (payout > address(this).balance) payout = address(this).balance;

        (bool ok, ) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Claimed(msg.sender, payout);
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────

    receive() external payable {}
}
