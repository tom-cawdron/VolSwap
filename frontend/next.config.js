/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Suppress warnings from WalletConnect / MetaMask SDK optional dependencies
    config.externals.push("pino-pretty", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

module.exports = nextConfig;
