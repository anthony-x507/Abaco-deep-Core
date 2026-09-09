/**
 * electron-builder config for ABACO Deep Core — UNSIGNED macOS builds.
 *
 * This config intentionally disables code signing and notarization so the
 * project can ship to internal testers / multiple Macs before the Apple
 * Developer ID arrives. When the Developer ID is provisioned:
 *
 *   1. Re-enable `hardenedRuntime`, `gatekeeperAssess`, `notarize`.
 *   2. Provide an `identity` (Developer ID Application) or rely on electron-builder
 *      auto-discovery from the keychain.
 *   3. Provide notarization credentials via env (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD
 *      / APPLE_TEAM_ID) or a stored `notarytool` keychain profile.
 *
 * See `sign-stub.sh` and `notarize-stub.sh` for the placeholder scripts.
 */
'use strict';

const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const desktopDir = path.join(repoRoot, 'desktop');
// The Electron app sources live one level deeper than `desktop/`. When the
// project restructures and the Electron package.json is hoisted to `desktop/`,
// just change the path below.
const electronPackageDir = path.join(desktopDir, 'src', 'dsh-desktop');

module.exports = {
  // Project metadata --------------------------------------------------------
  appId: 'io.abaco.deepcore',
  productName: 'ABACO Deep Core',
  copyright: 'Copyright © 2026 Anthony Sanchez',

  // Packaging layout --------------------------------------------------------
  asar: false,
  compression: 'maximum',
  artifactName: 'abaco-deep-core-${os}-${arch}-${version}.${ext}',

  // Auto-updater feed -------------------------------------------------------
  // electron-updater reads `latest-mac.yml` (and a per-channel copy) from
  // this generic endpoint. We point at the GitHub `latest/download` redirect
  // so any compatible release URL works.
  publish: {
    provider: 'generic',
    url: 'https://github.com/anthony-x507/Abaco-deep-Core/releases/latest/download',
    channel: 'latest',
    useMultipleRangeRequest: false
  },

  // Where electron-builder reads/writes ------------------------------------
  directories: {
    output: path.join(__dirname, 'artifacts'),
    // Brand assets (icon.icns lives at desktop/brand/icon.icns).
    buildResources: path.join(desktopDir, 'brand')
  },

  // We package from the Electron package directory; the script in make.sh
  // runs electron-builder from there. This is a defensive hint.
  // (electron-builder walks up to find the nearest package.json.)
  extraMetadata: {
    main: './out/main/index.js',
    name: 'abaco-deep-core',
    productName: 'ABACO Deep Core'
  },

  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    icon: path.join(desktopDir, 'brand', 'icon.icns'),
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: true,
    identity: 'Anthony Sanchez (GKPMCWHU2H)',
    // notarize is a boolean in electron-builder 26. APPLE_TEAM_ID env
    // (exported as GKPMCWHU2H) supplies the team id to @electron/notarize.
    notarize: true,
    extendInfo: {
      NSHumanReadableCopyright: 'ABACO Deep Core — Anthony Sanchez'
    }
  },

  // Defensive: never auto-publish while unsigned. The release script
  // (`release-mac.sh`) is responsible for any upload.
  // (electron-builder still writes `latest-mac.yml` next to the artifacts
  // because `publish` is configured above.)
  electronLanguages: ['en-US', 'es-ES']
};
