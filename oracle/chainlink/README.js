// Chainlink Functions configuration for regime oracle updates.
//
// This directory contains the setup for Chainlink Functions,
// which can run arbitrary JS off-chain and push results on-chain.
//
// In production, this replaces the centralised push_update.py
// with a decentralised Chainlink DON executing the inference.
//
// Files to add:
//   - request.js          — Chainlink Functions source (JS that calls inference API)
//   - deploy-consumer.js  — Deploy a FunctionsConsumer contract
//   - secrets.json        — Encrypted API keys (DO NOT commit)
//
// Reference: https://docs.chain.link/chainlink-functions

// ─── Example Chainlink Functions Source ──────────────────────────────
//
// This JS runs inside the Chainlink Functions DON:
//
// const response = await Functions.makeHttpRequest({
//   url: "https://your-inference-api.com/predict",
//   method: "GET",
// });
//
// if (response.error) throw Error("Inference API failed");
//
// const { p_high_vol, p_low_vol, entropy } = response.data;
//
// // Encode as uint256 triplet (scaled by 1e18)
// const pHigh = Math.round(p_high_vol * 1e18);
// const pLow  = Math.round(p_low_vol * 1e18);
// const ent   = Math.round(entropy * 1e18);
//
// return Functions.encodeUint256(pHigh);
// // Note: For multiple return values, use abi.encode off-chain
// // and abi.decode on the consumer contract.
