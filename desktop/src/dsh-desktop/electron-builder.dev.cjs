const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.abaco.deepcore.dev',
  productName: 'ABACO DEEP HARNES Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'abaco-deep-harnes-dev',
    productName: 'ABACO DEEP HARNES Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'abaco-deep-harnes-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'abaco-deep-harnes-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}