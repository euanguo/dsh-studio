import type { LocaleMessages } from '@dsh-studio/shared/i18n'

export type MarketplaceMessage =
  | 'plugins'
  | 'subtitle'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'updates'
  | 'sort.label'
  | 'sort.smart'
  | 'sort.stars'
  | 'sort.downloads'
  | 'sort.updated'
  | 'sort.name'
  | 'screenshots'
  | 'stars'
  | 'downloads'
  | 'compatibility'
  | 'update-available'
  | 'compatibility.unknown'
  | 'compatibility.ok'
  | 'compatibility.broken'
  | 'compatibility.unmaintained'
  | 'not-installed'
  | 'managed'
  | 'all'
  | 'all-categories'
  | 'mechanism.repository'
  | 'mechanism.bundle'
  | 'mechanism.discover'
  | 'mechanism.unsupported'
  | 'details'
  | 'install-direct'
  | 'try-preview'
  | 'enable'
  | 'disable'
  | 'uninstall'
  | 'readme-summary'
  | 'channel'
  | 'version'
  | 'plan-title'
  | 'fast-path-ready'
  | 'configuration-required'
  | 'continue-install'
  | 'progress.copy'
  | 'progress.fetch'
  | 'progress.install'
  | 'progress.verify'
  | 'progress.rehoming'
  | 'progress.swap'
  | 'progress.restart'
  | 'progress.collect-input'
  | 'progress.in-progress'
  | 'progress.eta'
  | 'watchlist'
  | 'watchlist-review'
  | 'update-all'
  | 'self-update'
  | 'update-now'
  | 'packs'
  | 'install-pack'
  | 'select-plugin'
  | 'select-plugin-description'
  | 'updated'
  | 'unknown'
  | 'repository'
  | 'trust'
  | 'trust.organization'
  | 'trust.community'
  | 'trust.untrusted'
  | 'runtime-boundary'
  | 'risk.profile-bundle'
  | 'risk.trusted-host'
  | 'risk.guided'
  | 'risk-level'
  | 'risk-level.low'
  | 'risk-level.elevated'
  | 'risk-level.high'
  | 'risk-level.blocked'
  | 'risk-reason.install-scripts'
  | 'risk-reason.trusted-host-code'
  | 'risk-reason.source-change'
  | 'risk-reason.protected-plugin'
  | 'risk-reason.unsupported-runtime'
  | 'risk-reason.untrusted-source'
  | 'risk-reason.incompatible-peer'
  | 'source-review'
  | 'source-review.first-use'
  | 'source-review.matched'
  | 'source-review.changed'
  | 'current-commit'
  | 'latest-commit'
  | 'action.install'
  | 'action.update'
  | 'action.enable'
  | 'action.disable'
  | 'action.uninstall'
  | 'action.pack'
  | 'package'
  | 'allow-scripts'
  | 'accept-high-risk'
  | 'accept-source-change'
  | 'recovery-note'
  | 'flow.review'
  | 'flow.preview'
  | 'flow.apply'
  | 'open-repository'
  | 'preview.install'
  | 'preview.update'
  | 'preview.enable'
  | 'preview.disable'
  | 'preview.uninstall'
  | 'preview.launch'
  | 'view-source'
  | 'undo-last-apply'
  | 'working'
  | 'refresh'
  | 'close'
  | 'preview.running'
  | 'discard'
  | 'apply-to-desktop'
  | 'apply-action'
  | 'apply-acknowledge'
  | 'cancel'
  | 'reset-and-reload'
  | 'direct-source.label'
  | 'direct-source.placeholder'
  | 'direct-source.submit'
  | 'search.label'
  | 'search.placeholder'
  | 'search.clear'
  | 'installation-status'
  | 'plugin-category'
  | 'plugin-count'
  | 'loading-catalog'
  | 'github-auth-required'
  | 'no-match'
  | 'auth.install-gh'
  | 'auth.ready'
  | 'auth.not-refreshed'
  | 'notice.loaded'
  | 'notice.preview-ready'
  | 'notice.discarded'
  | 'notice.applied'
  | 'notice.direct'
  | 'notice.staged'
  | 'notice.cancelled'
  | 'notice.restored'

export const MARKETPLACE_MESSAGES: LocaleMessages<MarketplaceMessage> = {
  en: {
    plugins: 'Plugins',
    subtitle: 'Public DSH catalog · direct install when safe · preview when you choose',
    installed: 'Installed',
    enabled: 'Enabled',
    disabled: 'Disabled',
    updates: 'Updates',
    'sort.label': 'Sort',
    'sort.smart': 'Recommended',
    'sort.stars': 'Most starred',
    'sort.downloads': 'Most downloaded',
    'sort.updated': 'Recently updated',
    'sort.name': 'Name',
    screenshots: 'Screenshots',
    stars: 'Stars',
    downloads: 'Downloads',
    compatibility: 'Compatibility',
    'update-available': 'Update available',
    'compatibility.unknown': 'Compatibility unknown',
    'compatibility.ok': 'Compatible',
    'compatibility.broken': 'Incompatible',
    'compatibility.unmaintained': 'Unmaintained',
    'not-installed': 'Not installed',
    managed: 'Desktop managed',
    all: 'All',
    'all-categories': 'All categories',
    'mechanism.repository': 'Repository',
    'mechanism.bundle': 'Bundle',
    'mechanism.discover': 'Auto-detect',
    'mechanism.unsupported': 'Browse only',
    details: '{plugin} details',
    'install-direct': 'Install',
    'try-preview': 'Try preview',
    enable: 'Enable',
    disable: 'Disable',
    uninstall: 'Uninstall',
    'readme-summary': 'README summary',
    channel: 'Install channel',
    version: 'Version',
    'plan-title': '{action} plan',
    'fast-path-ready': 'Verified fast path',
    'configuration-required': 'Configuration required',
    'continue-install': 'Continue installation',
    'progress.copy': 'Preparing profile',
    'progress.fetch': 'Fetching artifact',
    'progress.install': 'Installing package',
    'progress.verify': 'Verifying installation',
    'progress.rehoming': 'Preparing live profile',
    'progress.swap': 'Switching profile',
    'progress.restart': 'Restarting DSH',
    'progress.collect-input': 'Waiting for configuration',
    'progress.in-progress': 'In progress',
    'progress.eta': '{seconds}s remaining',
    watchlist: 'Watchlist ({count})',
    'watchlist-review': 'awaiting review',
    'update-all': 'Update all',
    'self-update': 'Marketplace update available: {version}',
    'update-now': 'Update now',
    packs: 'Packs',
    'install-pack': 'Install pack',
    'select-plugin': 'Select a plugin',
    'select-plugin-description': 'Choose a plugin to inspect and install.',
    updated: 'Updated',
    unknown: 'Unknown',
    repository: 'Repository',
    trust: 'Source trust',
    'trust.organization': 'Registry reviewed source',
    'trust.community': 'Community source',
    'trust.untrusted': 'Untrusted source',
    'runtime-boundary': 'Runtime boundary',
    'risk.profile-bundle': 'Official Profile bundle mechanism',
    'risk.trusted-host': 'Trusted host code after apply',
    'risk.guided': 'Guided install only',
    'risk-level': 'Risk level',
    'risk-level.low': 'Low',
    'risk-level.elevated': 'Elevated',
    'risk-level.high': 'High',
    'risk-level.blocked': 'Blocked',
    'risk-reason.install-scripts': 'Declares install-time scripts',
    'risk-reason.trusted-host-code': 'Runs as trusted host code after apply',
    'risk-reason.source-change': 'Source identity differs from the TOFU lock',
    'risk-reason.protected-plugin': 'Owned by the desktop transaction layer',
     'risk-reason.unsupported-runtime': 'Not consumed by the pinned DSH runtime',
     'risk-reason.untrusted-source': 'Direct source requires first-use approval',
     'risk-reason.incompatible-peer': 'Declared DSH peer range is incompatible',
    'source-review': 'Source lock',
    'source-review.first-use': 'First use · lock after apply',
    'source-review.matched': 'Matches the stored TOFU identity',
    'source-review.changed': 'Changed · explicit approval required',
    'current-commit': 'Installed commit',
    'latest-commit': 'Latest commit',
    'action.install': 'install',
    'action.update': 'update',
    'action.enable': 'enable',
    'action.disable': 'disable',
    'action.uninstall': 'uninstall',
    'action.pack': 'pack',
    package: 'package {package}',
    'allow-scripts': 'Allow these scripts only inside the write-restricted preview.',
    'accept-high-risk': 'I understand that this plugin runs as trusted host code after apply.',
    'accept-source-change': 'I reviewed and accept the changed source identity.',
    'recovery-note': 'Apply swaps the profile atomically. The previous profile stays available for recovery; arbitrary external effects are not rolled back.',
    'flow.review': 'Review',
    'flow.preview': 'Preview',
    'flow.apply': 'Apply',
    'open-repository': 'Open repository',
    'preview.install': 'Preview install',
    'preview.update': 'Preview update',
    'preview.enable': 'Preview enable',
    'preview.disable': 'Preview disable',
    'preview.uninstall': 'Preview uninstall',
    'preview.launch': 'Launch isolated preview',
    'view-source': 'View source',
    'undo-last-apply': 'Undo last apply',
    working: 'Working…',
    refresh: 'Refresh',
    close: 'Close Plugins',
    'preview.running': '{plugin} is running in an isolated preview window.',
    discard: 'Discard',
    'apply-to-desktop': 'Apply to desktop',
    'apply-action': 'Apply {action}',
    'apply-acknowledge': 'I understand and acknowledge the recovery boundary above.',
    cancel: 'Cancel',
    'reset-and-reload': 'Reset and reload',
    'direct-source.label': 'Public GitHub repository',
     'direct-source.placeholder': 'owner/repo or https://github.com/owner/repo',
     'direct-source.submit': 'Inspect source',
     'search.label': 'Search plugins',
    'search.placeholder': 'Search plugins, skills, and tags…',
    'search.clear': 'Clear plugin search',
    'installation-status': 'Installation status',
    'plugin-category': 'Plugin category',
    'plugin-count': '{count} plugins',
    'loading-catalog': 'Loading the plugin catalog…',
    'github-auth-required': 'GitHub authentication required',
    'no-match': 'No plugins match this view.',
    'auth.install-gh': 'Install GitHub CLI and run `gh auth login` to browse private organization plugins.',
    'auth.ready': 'Authenticated with GitHub CLI.',
    'auth.not-refreshed': 'Plugin catalog has not been refreshed yet.',
    'notice.loaded': 'Loaded {count} catalog plugins.',
    'notice.preview-ready': 'Isolated {action} preview is ready for {plugin}.',
    'notice.discarded': 'Discarded the {plugin} preview without changing the desktop profile.',
    'notice.applied': 'Applied {plugin}; the previous profile remains available for Undo.',
    'notice.direct': 'Installed {plugin}; restart DSH Studio to activate it. The previous profile remains available for Undo.',
    'notice.staged': 'Staged {plugin}; choose preview or apply to continue.',
    'notice.cancelled': 'Cancelled {plugin} without changing the live profile.',
    'notice.restored': 'Restored the profile from before {plugin} was applied.',
  },
  zh: {
    plugins: '插件',
    subtitle: '公开 DSH 目录 · 安全时直接安装 · 需要时再试装预览',
    installed: '已安装',
    enabled: '已启用',
    disabled: '已停用',
    updates: '可更新',
    'sort.label': '排序',
    'sort.smart': '推荐',
    'sort.stars': '星数最多',
    'sort.downloads': '下载最多',
    'sort.updated': '最近更新',
    'sort.name': '名称',
    screenshots: '截图',
    stars: '星数',
    downloads: '下载量',
    compatibility: '兼容性',
    'update-available': '有可用更新',
    'compatibility.unknown': '兼容性未知',
    'compatibility.ok': '兼容',
    'compatibility.broken': '不兼容',
    'compatibility.unmaintained': '已停止维护',
    'not-installed': '未安装',
    managed: '由桌面端管理',
    all: '全部',
    'all-categories': '全部分类',
    'mechanism.repository': '仓库插件',
    'mechanism.bundle': '插件包',
    'mechanism.discover': '自动检测',
    'mechanism.unsupported': '仅浏览',
    details: '{plugin} 详情',
    'install-direct': '安装',
    'try-preview': '先试装',
    enable: '启用',
    disable: '停用',
    uninstall: '卸载',
    'readme-summary': 'README 摘要',
    channel: '安装来源',
    version: '版本',
    'plan-title': '{action}方案',
    'fast-path-ready': '已验证，可直接安装',
    'configuration-required': '需要配置',
    'continue-install': '继续安装',
    'progress.copy': '准备 Profile',
    'progress.fetch': '下载插件',
    'progress.install': '安装软件包',
    'progress.verify': '校验安装结果',
    'progress.rehoming': '准备正式 Profile',
    'progress.swap': '切换 Profile',
    'progress.restart': '重启 DSH',
    'progress.collect-input': '等待配置',
    'progress.in-progress': '处理中',
    'progress.eta': '还需 {seconds} 秒',
    watchlist: '观察区（{count}）',
    'watchlist-review': '等待审核',
    'update-all': '全部更新',
    'self-update': '插件市场有新版本：{version}',
    'update-now': '立即更新',
    packs: '整合包',
    'install-pack': '安装整合包',
    'select-plugin': '选择一个插件',
    'select-plugin-description': '从左侧选择插件查看详情并安装。',
    updated: '更新时间',
    unknown: '未知',
    repository: '仓库',
    trust: '来源信任',
    'trust.organization': 'Registry 已审核来源',
    'trust.community': '社区来源',
    'trust.untrusted': '不受信任来源',
    'runtime-boundary': '运行边界',
    'risk.profile-bundle': '官方 Profile 插件包机制',
    'risk.trusted-host': '应用后作为受信任主机代码运行',
    'risk.guided': '仅提供安装引导',
    'risk-level': '风险等级',
    'risk-level.low': '低',
    'risk-level.elevated': '中',
    'risk-level.high': '高',
    'risk-level.blocked': '已阻止',
    'risk-reason.install-scripts': '声明了安装阶段脚本',
    'risk-reason.trusted-host-code': '应用后会作为受信任主机代码运行',
    'risk-reason.source-change': '来源身份与 TOFU 锁不一致',
    'risk-reason.protected-plugin': '由桌面事务层自身管理',
     'risk-reason.unsupported-runtime': '当前 pinned DSH runtime 不消费',
     'risk-reason.untrusted-source': '直接来源首次使用需要确认',
     'risk-reason.incompatible-peer': '声明的 DSH peer 版本不兼容',
    'source-review': '来源锁',
    'source-review.first-use': '首次使用 · 应用后写入锁',
    'source-review.matched': '与已保存的 TOFU 身份一致',
    'source-review.changed': '来源有变化 · 需要明确确认',
    'current-commit': '已安装提交',
    'latest-commit': '最新提交',
        'action.install': '安装',
    'action.update': '更新',
    'action.enable': '启用',
    'action.disable': '停用',
    'action.uninstall': '卸载',
    'action.pack': '整合包',
    package: '软件包 {package}',
    'allow-scripts': '仅允许在写入受限的预览环境中运行这些脚本。',
    'accept-high-risk': '我了解应用后该插件会作为受信任主机代码运行。',
    'accept-source-change': '我已检查并接受变化后的来源身份。',
    'recovery-note': '应用时会原子替换 Profile，并保留上一版本用于恢复；插件产生的任意外部副作用不在回滚范围内。',
    'flow.review': '检查',
    'flow.preview': '预览',
    'flow.apply': '应用',
    'open-repository': '打开仓库',
    'preview.install': '预览安装',
    'preview.update': '预览更新',
    'preview.enable': '预览启用',
    'preview.disable': '预览停用',
    'preview.uninstall': '预览卸载',
    'preview.launch': '启动隔离预览',
    'view-source': '查看源码',
    'undo-last-apply': '撤销上次应用',
    working: '处理中…',
    refresh: '刷新',
    close: '关闭插件市场',
    'preview.running': '{plugin} 正在隔离预览窗口中运行。',
    discard: '放弃',
    'apply-to-desktop': '应用到桌面端',
    'apply-action': '应用{action}',
    'apply-acknowledge': '我了解并同意上述恢复边界。',
    cancel: '取消',
    'reset-and-reload': '重置并重新加载',
    'direct-source.label': '公开 GitHub 仓库',
     'direct-source.placeholder': 'owner/repo 或 https://github.com/owner/repo',
     'direct-source.submit': '检查来源',
     'search.label': '搜索插件',
    'search.placeholder': '搜索插件、技能和标签…',
    'search.clear': '清空插件搜索',
    'installation-status': '安装状态',
    'plugin-category': '插件分类',
    'plugin-count': '{count} 个插件',
    'loading-catalog': '正在加载组织插件目录…',
    'github-auth-required': '需要 GitHub 身份验证',
    'no-match': '当前视图中没有匹配的插件。',
    'auth.install-gh': '请安装 GitHub CLI 并运行 `gh auth login`，以浏览组织的私有插件。',
    'auth.ready': '已通过 GitHub CLI 完成身份验证。',
    'auth.not-refreshed': '插件目录尚未刷新。',
    'notice.loaded': '已加载 {count} 个目录插件。',
    'notice.preview-ready': '{plugin} 的隔离{action}预览已就绪。',
    'notice.discarded': '已放弃 {plugin} 的预览，桌面端配置未发生更改。',
    'notice.applied': '已应用 {plugin}；之前的配置仍可撤销恢复。',
    'notice.direct': '已安装 {plugin}；重启 DSH Studio 后生效。之前的配置仍可撤销恢复。',
    'notice.staged': '已暂存 {plugin}；可以继续试装预览或直接应用。',
    'notice.cancelled': '已取消 {plugin}，正式 Profile 未发生变化。',
    'notice.restored': '已恢复应用 {plugin} 之前的配置。',
  },
}
