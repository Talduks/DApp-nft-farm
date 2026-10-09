import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dappnftfarm.app',
  appName: 'DApp NFT Farm',
  webDir: 'dist',
  backgroundColor: '#020617',
  android: {
    // Production builds never expose the WebView to chrome://inspect.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge with --safe-area-inset-* CSS variables (see src/index.css).
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
