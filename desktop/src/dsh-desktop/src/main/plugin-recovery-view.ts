import type { RuntimeSnapshot } from '../shared/contracts'

export type PluginRecoveryLocale = 'en' | 'zh'

export interface PluginRecoveryUpgradeCandidate {
  packageName: string
  targetVersion: string
  installedVersion?: string
}

export interface PluginRecoveryViewModel {
  locale: PluginRecoveryLocale
  brand: string
  badge: string
  heading: string
  summary: string
  reasonTitle: string
  reasonDetail: string
  plugins: string[]
  removedPlugins: string[]
  progress?: string
  notice?: string
  safetyNote: string
  primaryLabel: string
  primaryBusyLabel: string
  upgradeCandidate?: PluginRecoveryUpgradeCandidate
  upgradeLabel?: string
  upgradeBusyLabel?: string
  upgradeHint?: string
  uninstallLabel?: string
  logLabel: string
  advancedLabel: string
  errorLabel: string
  launchDirectoryLabel: string
  launchDirectory?: string
  rawError: string
  quitLabel: string
  safeModeLabel: string
  canUninstall: boolean
}

interface FailureDescription {
  title: string
  detail: string
}

function displayPluginName(packageName: string): string {
  if (!packageName.startsWith('@')) return packageName
  return packageName.slice(packageName.indexOf('/') + 1)
}

function latestAttemptText(logs: readonly string[]): string {
  let startIndex = -1
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index]?.trimStart().startsWith('[desktop] starting ')) {
      startIndex = index
      break
    }
  }
  return logs.slice(startIndex + 1).join('\n')
}

const LOADER_ENTRY_FAILURE =
  /failed to (?:apply|import) loader entry [^\s]+ \((@[^)]+|[^)]+)\)/gi

/**
 * Names printed in a loader import/apply failure. First-party patch rows
 * (abaco-analytics, …) show up here even though they are not removable
 * profile plugins — recovery must name them instead of claiming the
 * failure is unidentified.
 */
export function extractNamedLoaderFailures(logs: readonly string[]): string[] {
  const names = new Set<string>()
  const text = latestAttemptText(logs)
  for (const match of text.matchAll(LOADER_ENTRY_FAILURE)) {
    const name = match[1]?.trim()
    if (!name || name.includes(':')) continue
    names.add(name)
  }
  return [...names]
}

function unnamedRecoverySummary(
  locale: PluginRecoveryLocale,
  namedFailures: readonly string[]
): string {
  if (namedFailures.length === 0) {
    return locale === 'zh'
      ? '暂时无法定位到具体插件。你可以进入安全模式，停用所有第三方插件并继续使用 Agent。'
      : 'No specific plugin could be identified. Enter Safe Mode to disable all third-party plugins and keep using the Agent.'
  }

  const listed = namedFailures.join(', ')
  return locale === 'zh'
    ? `${listed} 已在启动日志中定位，但它不是可卸载的 Profile 插件（例如桌面补丁里的一等插件）。进入安全模式可跳过可选附加项并继续使用 Agent。已停用的插件不会被重新启用。`
    : `${listed} is named in the startup log, but it is not a removable profile plugin (for example a first-party desktop patch row). Enter Safe Mode to skip optional extras and keep using the Agent. Disabled plugins stay disabled.`
}

export function describePluginFailure(
  logs: readonly string[],
  locale: PluginRecoveryLocale
): FailureDescription {
  const text = latestAttemptText(logs)
  const duplicateRoute = text.match(/duplicate prefix route ["']([^"']+)["']/i)?.[1]

  if (duplicateRoute) {
    return locale === 'zh'
      ? {
          title: '插件使用了重复的服务入口',
          detail: `启动日志显示 ${duplicateRoute} 被重复注册，因此 Harness 无法继续启动。`
        }
      : {
          title: 'A plugin registered a duplicate service route',
          detail: `The startup log shows that ${duplicateRoute} was registered more than once, so Harness could not continue.`
        }
  }
 
  if (/duplicate loader entry id/i.test(text)) {
    const entryId = text.match(/duplicate loader entry id:\s*([^\s]+)/i)?.[1]
    return locale === 'zh'
      ? {
          title: '插件注册了重复的服务组件',
          detail: `启动日志显示组件 ${entryId ? `"${entryId}"` : ''} 被重复定义，插件之间存在加载冲突，因此 Harness 无法继续启动。`
        }
      : {
          title: 'A plugin registered a duplicate service component',
          detail: `The startup log shows that component ${entryId ? `"${entryId}"` : ''} was registered more than once due to a plugin conflict.`
        }
  }

  if (/cannot resolve profile bundle/i.test(text)) {
    return locale === 'zh'
      ? {
          title: '插件没有完整安装',
          detail: '配置中仍然引用了这个插件，但本地找不到对应的插件包。'
        }
      : {
          title: 'The plugin is not fully installed',
          detail: 'The profile still references this plugin, but its package cannot be found locally.'
        }
  }

  if (/declares no dsh\.bundle/i.test(text)) {
    return locale === 'zh'
      ? {
          title: '安装的包不是兼容的 DSH 插件',
          detail: '这个包缺少 DSH 插件所需的入口声明，因此 Harness 无法加载。'
        }
      : {
          title: 'The package is not a compatible DSH plugin',
          detail: 'It does not declare the entry point required by Harness.'
        }
  }

  if (/single slot\s+["'][^"']+["']\s+already has a registration/i.test(text)) {
    const slotName = text.match(/single slot\s+["']([^"']+)["']/i)?.[1]
    return locale === 'zh'
      ? {
          title: '插件存在界面插槽冲突',
          detail: `检测到界面插槽 ${slotName ? `"${slotName}"` : ''} 存在重复注册，多个第三方插件试图占用相同的界面组件，导致前端无法正常渲染。`
        }
      : {
          title: 'A plugin has a UI slot conflict',
          detail: `UI slot ${slotName ? `"${slotName}"` : ''} has duplicate registrations from conflicting plugins.`
        }
  }

  if (/failed to import loader entry/i.test(text)) {
    const named = text.match(/failed to import loader entry [^\s]+ \((@[^)]+|[^)]+)\)/i)?.[1]?.trim()
    const moduleTableMiss = /missed the module table/i.test(text)
    const required = text.match(/require\((["'][^"']+["'])\)\s+missed the module table/i)?.[1]
    if (locale === 'zh') {
      return {
        title: '插件代码加载失败',
        detail: named
          ? moduleTableMiss
            ? `${named} 无法导入：${required ? `require(${required})` : '相对 require'} 不在客户端 module table（不是平台种子、也不是已物化模块）。这是打包缺陷，不是第三方安装损坏。`
            : `${named} 的客户端代码无法加载。文件可能损坏、缺少依赖，或与当前 Harness 版本不兼容。`
          : '插件文件可能损坏、缺少依赖，或与当前 Harness 版本不兼容。'
      }
    }
    return {
      title: 'The plugin code could not be loaded',
      detail: named
        ? moduleTableMiss
          ? `${named} failed to import: ${required ? `require(${required})` : 'a relative require'} missed the client module table (not a platform seed, not a materialized module). That is a packaging bug, not a damaged third-party install.`
          : `${named} could not be loaded. Its files may be damaged, missing a dependency, or incompatible with this Harness version.`
        : 'Its files may be damaged, missing a dependency, or incompatible with this Harness version.'
    }
  }

  return locale === 'zh'
    ? {
        title: '插件启动失败',
        detail: 'Harness 在加载插件时发生错误，但暂时无法自动判断更具体的原因。'
      }
    : {
        title: 'A plugin failed during startup',
        detail: 'Harness reported an error while loading a plugin, but the exact cause could not be determined automatically.'
      }
}

export function buildPluginRecoveryViewModel(options: {
  snapshot: RuntimeSnapshot
  plugins: readonly string[]
  removedPlugins: readonly string[]
  locale: PluginRecoveryLocale
  notice?: string
  upgradeCandidate?: PluginRecoveryUpgradeCandidate
}): PluginRecoveryViewModel {
  const { snapshot, locale, notice, upgradeCandidate } = options
  const pluginPackages = [...new Set(options.plugins)]
  const plugins = pluginPackages.map(displayPluginName)
  const removedPlugins = [...new Set(options.removedPlugins)].map(displayPluginName)
  const canUninstall = plugins.length > 0
  const description = describePluginFailure(snapshot.logs, locale)
  const multiple = plugins.length > 1
  const namedFailures = extractNamedLoaderFailures(snapshot.logs)
  const unnamedHeading = namedFailures.length > 0
    ? namedFailures.length > 1
      ? locale === 'zh'
        ? `发现 ${namedFailures.length} 个无法卸载的失败插件`
        : `${namedFailures.length} plugins failed to load`
      : locale === 'zh'
        ? '发现无法卸载的失败插件'
        : 'A plugin failed to load'
    : locale === 'zh'
      ? 'Harness 暂时无法启动'
      : 'Harness could not start'
  const unnamedSummary = unnamedRecoverySummary(locale, namedFailures)

  if (locale === 'zh') {
    return {
      locale,
      brand: 'ABACO DEEP HARNES',
      badge: '启动修复',
      heading: canUninstall
        ? multiple ? `发现 ${plugins.length} 个导致启动失败的插件` : '发现导致启动失败的插件'
        : unnamedHeading,
      summary: canUninstall
        ? ''
        : unnamedSummary,
      reasonTitle: description.title,
      reasonDetail: description.detail,
      plugins,
      removedPlugins,
      progress: removedPlugins.length > 0
        ? `已处理 ${removedPlugins.length} 个插件，正在继续检查剩余问题。`
        : undefined,
      notice,
      safetyNote: '工作区、会话、模型配置和其他插件不会被删除。',
      primaryLabel: canUninstall
        ? multiple ? `卸载这 ${plugins.length} 个插件并继续检测` : '卸载此插件并继续检测'
        : '进入安全模式',
      primaryBusyLabel: canUninstall ? '正在处理并重新检测…' : '正在进入安全模式…',
      upgradeCandidate,
      upgradeLabel: upgradeCandidate
        ? '升级插件并重启'
        : undefined,
      upgradeBusyLabel: upgradeCandidate ? '正在升级…' : undefined,
      upgradeHint: upgradeCandidate
        ? `该插件有新的兼容版本（${upgradeCandidate.targetVersion.startsWith('v') ? upgradeCandidate.targetVersion : `v${upgradeCandidate.targetVersion}`}）`
        : undefined,
      uninstallLabel: upgradeCandidate ? '卸载插件' : undefined,
      logLabel: '打开 Harness 日志',
      advancedLabel: '查看技术详情',
      errorLabel: '错误信息',
      launchDirectoryLabel: '启动目录',
      launchDirectory: snapshot.launchDirectory,
      rawError: snapshot.message,
      quitLabel: '退出 ABACO DEEP HARNES',
      safeModeLabel: '进入安全模式',
      canUninstall
    }
  }

  return {
    locale,
    brand: 'ABACO DEEP HARNES',
    badge: 'Startup recovery',
    heading: canUninstall
      ? multiple ? `${plugins.length} plugins are preventing startup` : 'A plugin is preventing startup'
      : unnamedHeading,
    summary: canUninstall
      ? ''
      : unnamedSummary,
    reasonTitle: description.title,
    reasonDetail: description.detail,
    plugins,
    removedPlugins,
    progress: removedPlugins.length > 0
      ? `${removedPlugins.length} plugin${removedPlugins.length === 1 ? '' : 's'} handled. Checking for remaining issues.`
      : undefined,
    notice,
    safetyNote: 'Your workspaces, sessions, model settings, and other plugins will not be removed.',
    primaryLabel: canUninstall
      ? multiple ? `Remove these ${plugins.length} plugins and continue` : 'Remove this plugin and continue'
      : 'Enter Safe Mode',
    primaryBusyLabel: canUninstall ? 'Removing and checking again…' : 'Entering Safe Mode…',
    upgradeCandidate,
    upgradeLabel: upgradeCandidate
      ? 'Upgrade plugin and restart'
      : undefined,
    upgradeBusyLabel: upgradeCandidate ? 'Upgrading…' : undefined,
    upgradeHint: upgradeCandidate
      ? `A compatible update is available (${upgradeCandidate.targetVersion.startsWith('v') ? upgradeCandidate.targetVersion : `v${upgradeCandidate.targetVersion}`})`
      : undefined,
    uninstallLabel: upgradeCandidate ? 'Uninstall plugin' : undefined,
    logLabel: 'Open Harness log',
    advancedLabel: 'View technical details',
    errorLabel: 'Error details',
    launchDirectoryLabel: 'Launch directory',
    launchDirectory: snapshot.launchDirectory,
    rawError: snapshot.message,
    quitLabel: 'Quit ABACO DEEP HARNES',
    safeModeLabel: 'Enter Safe Mode',
    canUninstall
  }
}
