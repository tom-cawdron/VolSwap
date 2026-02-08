// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RegimeOracle.sol";

/**
 * @title MultiverseMarket
 * @notice Round-based volatility prediction market with proportional payouts.
 *
 * Every hour a new Round is opened by the oracle operator:
 *   1. `openNewRound()` snapshots the current 24h realised volatility.
 *   2. Users bet ETH on whether vol will be HIGHER or LOWER in 24h.
 *   3. After 24h, `resolveRound()` compares the new vol to the snapshot.
 *   4. Winning side splits USER collateral proportionally (seed excluded).
 *
 * Each round is seeded with `seedAmount` ETH on each side to provide
 * baseline LMSR liquidity and prevent early buyers from swinging prices.
 * Seed collateral is excluded from payouts and recycled to the reserve.
 *
 * Pricing uses LMSR (Logarithmic Market Scoring Rule) per round.
 * Fees are entropy-adaptive (wider when ML model is uncertain).
 */
contract MultiverseMarket {
    // ─── Types ───────────────────────────────────────────────────────────

    struct Round {
        uint256 snapshotVol;       // realised vol at open (1e18)
        uint256 tradingEnd;        // timestamp: no more buys after this
        uint256 resolutionTime;    // timestamp: can resolve after this
        uint256 totalCollateral;   // total ETH in the round pool (seed + user)
        uint256 totalHighTokens;   // total HIGH_VOL tokens minted (seed + user)
        uint256 totalLowTokens;    // total LOW_VOL tokens minted (seed + user)
        int256  qHigh;             // LMSR quantity HIGH
        int256  qLow;              // LMSR quantity LOW
        bool    resolved;
        bool    highVolWon;
        uint256 resolvedVol;       // realised vol at resolution (1e18)
        uint256 seedCollateral;    // ETH contributed by protocol seed
        uint256 seedHighTokens;    // seed tokens on HIGH side
        uint256 seedLowTokens;     // seed tokens on LOW side
    }

    // ─── State ───────────────────────────────────────────────────────────

    RegimeOracle public oracle;
    address public operator;

    /// @notice LMSR liquidity parameter (higher = deeper liquidity)
    uint256 public b;

    /// @notice Round counter (starts at 1)
    uint256 public currentRoundId;

    /// @notice Rounds storage
    mapping(uint256 => Round) public rounds;

    /// @notice Per-round per-user token balances
    mapping(uint256 => mapping(address => uint256)) public highVolBalance;
    mapping(uint256 => mapping(address => uint256)) public lowVolBalance;

    /// @notice Trading window duration (default 1 hour)
    uint256 public tradingDuration = 1 hours;

    /// @notice Resolution delay after round open (default 24 hours)
    uint256 public resolutionDelay = 24 hours;

    /// @notice Maximum entropy for fee calculation: ln(2) ≈ 0.6931 (scaled 1e18)
    uint256 public constant MAX_ENTROPY = 693147180559945309;

    /// @notice Fee bounds (scaled 1e18): 0.5% to 5%
    uint256 public constant MIN_FEE = 5e15;   // 0.005
    uint256 public constant MAX_FEE = 50e15;  // 0.050

    /// @notice Seed amount per side (default 0.5 ETH)
    uint256 public seedAmount = 0.5 ether;

    /// @notice Reserve balance for seeding rounds
    uint256 public seedReserve;

    // ─── Events ──────────────────────────────────────────────────────────

    event RoundOpened(uint256 indexed roundId, uint256 snapshotVol, uint256 tradingEnd, uint256 resolutionTime);
    event RoundSeeded(uint256 indexed roundId, uint256 seedCollateral, uint256 seedHighTokens, uint256 seedLowTokens);
    event OutcomeBought(uint256 indexed roundId, address indexed buyer, bool isHighVol, uint256 amount, uint256 cost, uint256 fee);
    event RoundResolved(uint256 indexed roundId, bool highVolWon, uint256 snapshotVol, uint256 resolvedVol);
    event PayoutClaimed(uint256 indexed roundId, address indexed user, uint256 payout);
    event NewRoundStarted(uint256 indexed oldRoundId, uint256 indexed newRoundId);

    // ─── Errors ──────────────────────────────────────────────────────────

    error Unauthorized();
    error RoundAlreadyResolved();
    error RoundNotResolved();
    error TradingClosed();
    error TooEarlyToResolve();
    error InsufficientPayment();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidRound();
    error CurrentRoundNotResolved();
    error InsufficientSeedReserve();

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _oracle, uint256 _b) {
        oracle = RegimeOracle(_oracle);
        operator = msg.sender;
        b = _b;
    }

    // ─── Round Lifecycle ─────────────────────────────────────────────────

    /**
     * @notice Open a new prediction round.  Snapshots the current realised vol
     *         from the oracle.  Called hourly by the oracle bridge.
     *         Seeds the round with protocol liquidity on both sides.
     */
    function openNewRound() external onlyOperator returns (uint256 roundId) {
        currentRoundId++;
        roundId = currentRoundId;

        uint256 snap = oracle.getRealisedVol();

        rounds[roundId] = Round({
            snapshotVol: snap,
            tradingEnd: block.timestamp + tradingDuration,
            resolutionTime: block.timestamp + resolutionDelay,
            totalCollateral: 0,
            totalHighTokens: 0,
            totalLowTokens: 0,
            qHigh: 0,
            qLow: 0,
            resolved: false,
            highVolWon: false,
            resolvedVol: 0,
            seedCollateral: 0,
            seedHighTokens: 0,
            seedLowTokens: 0
        });

        emit RoundOpened(roundId, snap, block.timestamp + tradingDuration, block.timestamp + resolutionDelay);

        _seedRound(roundId);
    }

    /**
     * @notice Buy outcome tokens for a given round.
     * @param roundId    ID of the round to bet on
     * @param isHighVol  true = bet vol goes HIGHER, false = LOWER
     * @param amount     Number of tokens to buy (1e18 scale)
     */
    function buyOutcome(uint256 roundId, bool isHighVol, uint256 amount) external payable returns (uint256) {
        Round storage round = rounds[roundId];
        if (round.snapshotVol == 0) revert InvalidRound();
        if (round.resolved) revert RoundAlreadyResolved();
        if (block.timestamp > round.tradingEnd) revert TradingClosed();

        // LMSR cost delta
        uint256 costBefore = _cost(round.qHigh, round.qLow);

        if (isHighVol) {
            round.qHigh += int256(amount);
        } else {
            round.qLow += int256(amount);
        }

        uint256 costAfter = _cost(round.qHigh, round.qLow);
        uint256 rawCost = costAfter > costBefore ? costAfter - costBefore : 0;

        // Entropy-adaptive fee
        uint256 fee = (rawCost * dynamicFee()) / 1e18;
        uint256 totalCost = rawCost + fee;

        if (msg.value < totalCost) revert InsufficientPayment();

        // Credit tokens
        if (isHighVol) {
            highVolBalance[roundId][msg.sender] += amount;
            round.totalHighTokens += amount;
        } else {
            lowVolBalance[roundId][msg.sender] += amount;
            round.totalLowTokens += amount;
        }

        round.totalCollateral += totalCost;

        // Refund excess ETH
        if (msg.value > totalCost) {
            (bool ok, ) = msg.sender.call{value: msg.value - totalCost}("");
            if (!ok) revert TransferFailed();
        }

        emit OutcomeBought(roundId, msg.sender, isHighVol, amount, rawCost, fee);
        return totalCost;
    }

    /**
     * @notice Resolve a round after its resolution time.
     *         Compares current oracle vol to the round's snapshot.
     *         HIGH wins if current vol > snapshot vol.
     * @param roundId The round to resolve
     */
    function resolveRound(uint256 roundId) external {
        Round storage round = rounds[roundId];
        if (round.snapshotVol == 0) revert InvalidRound();
        if (round.resolved) revert RoundAlreadyResolved();
        if (block.timestamp < round.resolutionTime) revert TooEarlyToResolve();

        uint256 currentVol = oracle.getRealisedVol();
        round.highVolWon = currentVol > round.snapshotVol;
        round.resolved = true;
        round.resolvedVol = currentVol;

        emit RoundResolved(roundId, round.highVolWon, round.snapshotVol, currentVol);
    }

    /**
     * @notice Claim proportional payout from a resolved round.
     *         Winners split only USER-contributed collateral (seed excluded).
     *         Payout = (userTokens / userWinningTokens) × userCollateral
     *         Seed collateral is returned to the reserve for reuse.
     * @param roundId The round to claim from
     */
    function claimPayout(uint256 roundId) external {
        Round storage round = rounds[roundId];
        if (!round.resolved) revert RoundNotResolved();

        uint256 userTokens;
        uint256 totalWinning;
        uint256 seedWinning;

        if (round.highVolWon) {
            userTokens = highVolBalance[roundId][msg.sender];
            totalWinning = round.totalHighTokens;
            seedWinning = round.seedHighTokens;
            highVolBalance[roundId][msg.sender] = 0;
        } else {
            userTokens = lowVolBalance[roundId][msg.sender];
            totalWinning = round.totalLowTokens;
            seedWinning = round.seedLowTokens;
            lowVolBalance[roundId][msg.sender] = 0;
        }

        if (userTokens == 0) revert InsufficientBalance();

        // Exclude seed from both pool and winning tokens
        uint256 userPool = round.totalCollateral - round.seedCollateral;
        uint256 userWinning = totalWinning - seedWinning;

        // If no user tokens on the winning side, nothing to pay out
        if (userWinning == 0) revert InsufficientBalance();

        uint256 payout = (userTokens * userPool) / userWinning;
        if (payout > address(this).balance) payout = address(this).balance;

        // Return seed collateral to reserve (once, on first claim)
        if (round.seedCollateral > 0) {
            seedReserve += round.seedCollateral;
            round.seedCollateral = 0;
        }

        (bool ok, ) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit PayoutClaimed(roundId, msg.sender, payout);
    }

    // ─── LMSR Math (fixed-point, 1e18 scale) ────────────────────────────

    function _expScaled(int256 q) internal view returns (uint256) {
        int256 exponent = (q * 1e18) / int256(b);
        if (exponent > 20e18) exponent = 20e18;
        if (exponent < -20e18) return 1;

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

    function _cost(int256 _qH, int256 _qL) internal view returns (uint256) {
        uint256 expH = _expScaled(_qH);
        uint256 expL = _expScaled(_qL);
        uint256 sumExp = expH + expL;
        uint256 logVal = _ln(sumExp);
        return (b * logVal) / 1e18;
    }

    function _ln(uint256 x) internal pure returns (uint256) {
        if (x <= 1e18) return 0;
        uint256 result = 0;
        uint256 LN2 = 693147180559945309;
        while (x >= 2e18) {
            x = x / 2;
            result += LN2;
        }
        uint256 y = x - 1e18;
        uint256 ONE = 1e18;
        uint256 yPow = y;
        result += yPow;
        yPow = (yPow * y) / ONE;
        result -= yPow / 2;
        yPow = (yPow * y) / ONE;
        result += yPow / 3;
        yPow = (yPow * y) / ONE;
        result -= yPow / 4;
        return result;
    }

    // ─── Dynamic Fee ─────────────────────────────────────────────────────

    function dynamicFee() public view returns (uint256) {
        uint256 entropy = oracle.getEntropy();
        if (entropy >= MAX_ENTROPY) return MAX_FEE;
        return MIN_FEE + ((MAX_FEE - MIN_FEE) * entropy) / MAX_ENTROPY;
    }

    // ─── View Helpers ────────────────────────────────────────────────────

    function getRound(uint256 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    function priceHighVol(uint256 roundId) external view returns (uint256) {
        Round storage round = rounds[roundId];
        uint256 expH = _expScaled(round.qHigh);
        uint256 expL = _expScaled(round.qLow);
        return (expH * 1e18) / (expH + expL);
    }

    function priceLowVol(uint256 roundId) external view returns (uint256) {
        Round storage round = rounds[roundId];
        uint256 expH = _expScaled(round.qHigh);
        uint256 expL = _expScaled(round.qLow);
        return (expL * 1e18) / (expH + expL);
    }

    function getUserPosition(uint256 roundId, address user) external view returns (uint256 high, uint256 low) {
        return (highVolBalance[roundId][user], lowVolBalance[roundId][user]);
    }

    // ─── Public Round Cycling ─────────────────────────────────────────────

    /**
     * @notice Start a new round after the current one has been resolved.
     *         Callable by ANYONE — no operator restriction.
     *         Takes a fresh snapshot vol from the oracle.
     */
    function startNewRound() external returns (uint256 newRoundId) {
        // Require the current round to be resolved (or no round exists yet)
        if (currentRoundId > 0) {
            Round storage current = rounds[currentRoundId];
            if (!current.resolved) revert CurrentRoundNotResolved();
        }

        currentRoundId++;
        newRoundId = currentRoundId;

        uint256 snap = oracle.getRealisedVol();

        rounds[newRoundId] = Round({
            snapshotVol: snap,
            tradingEnd: block.timestamp + tradingDuration,
            resolutionTime: block.timestamp + resolutionDelay,
            totalCollateral: 0,
            totalHighTokens: 0,
            totalLowTokens: 0,
            qHigh: 0,
            qLow: 0,
            resolved: false,
            highVolWon: false,
            resolvedVol: 0,
            seedCollateral: 0,
            seedHighTokens: 0,
            seedLowTokens: 0
        });

        emit RoundOpened(newRoundId, snap, block.timestamp + tradingDuration, block.timestamp + resolutionDelay);
        if (newRoundId > 1) {
            emit NewRoundStarted(newRoundId - 1, newRoundId);
        }

        _seedRound(newRoundId);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setTradingDuration(uint256 _duration) external onlyOperator {
        tradingDuration = _duration;
    }

    function setResolutionDelay(uint256 _delay) external onlyOperator {
        resolutionDelay = _delay;
    }

    function setSeedAmount(uint256 _seedAmount) external onlyOperator {
        seedAmount = _seedAmount;
    }

    function transferOperator(address _newOperator) external onlyOperator {
        operator = _newOperator;
    }

    // ─── Seed Reserve Management ─────────────────────────────────────────

    /// @notice Deposit ETH into the seed reserve (operator only)
    function depositSeedReserve() external payable onlyOperator {
        seedReserve += msg.value;
    }

    /// @notice Withdraw ETH from the seed reserve (operator only)
    function withdrawSeedReserve(uint256 amount) external onlyOperator {
        if (amount > seedReserve) revert InsufficientSeedReserve();
        seedReserve -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ─── Internal: Seed a round with protocol liquidity ──────────────────

    /**
     * @dev Seeds a newly opened round with `seedAmount` tokens on each side.
     *      Uses the LMSR cost function to determine ETH required.
     *      Both sides get equal seed → initial price stays 0.5 / 0.5.
     *      Seed ETH comes from `seedReserve`. If reserve is insufficient,
     *      the round proceeds unseeded (no revert).
     */
    function _seedRound(uint256 roundId) internal {
        if (seedAmount == 0) return;

        Round storage round = rounds[roundId];

        // Cost of buying seedAmount HIGH tokens from q=(0,0)
        uint256 costBefore = _cost(round.qHigh, round.qLow);
        int256 seedInt = int256(seedAmount);

        round.qHigh += seedInt;
        uint256 costAfterHigh = _cost(round.qHigh, round.qLow);
        uint256 highCost = costAfterHigh > costBefore ? costAfterHigh - costBefore : 0;

        // Cost of buying seedAmount LOW tokens from q=(seedAmount, 0)
        round.qLow += seedInt;
        uint256 costAfterBoth = _cost(round.qHigh, round.qLow);
        uint256 lowCost = costAfterBoth > costAfterHigh ? costAfterBoth - costAfterHigh : 0;

        uint256 totalSeedCost = highCost + lowCost;

        // If insufficient reserve, revert the q changes and skip seeding
        if (totalSeedCost > seedReserve) {
            round.qHigh -= seedInt;
            round.qLow -= seedInt;
            return;
        }

        // Deduct from reserve
        seedReserve -= totalSeedCost;

        // Record seed tokens and collateral
        round.totalHighTokens += seedAmount;
        round.totalLowTokens += seedAmount;
        round.totalCollateral += totalSeedCost;

        round.seedHighTokens = seedAmount;
        round.seedLowTokens = seedAmount;
        round.seedCollateral = totalSeedCost;

        emit RoundSeeded(roundId, totalSeedCost, seedAmount, seedAmount);
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────

    receive() external payable {}
}
