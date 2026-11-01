export const REFRESH_MS = 5000;
export const PAGE_SIZE = 100;
export const TURNS_PAGE_SIZE = 20;
export const EVENT_TIMEOUT_MS = 15000;

export const STATUS = {
  idle: { label: '未启动', tone: 'warn' },
  connecting: { label: '连接中…', tone: 'warn' },
  connected: { label: '已连接', tone: 'good' },
  'not-installed': { label: '未安装 codex', tone: 'bad' },
  'start-failed': { label: '启动失败', tone: 'bad' },
  disconnected: { label: '已断开', tone: 'bad' },
};

export const SOURCE_LABELS = {
  cli: 'CLI',
  vscode: 'VS Code',
  exec: 'exec',
  appServer: 'App Server',
  custom: '自定义',
  subAgent: '子代理',
  unknown: '未知',
};

export const TURN_STATUS = {
  unknown: '实时状态未核实',
  completed: '完成',
  interrupted: '已中断',
  failed: '失败',
  inProgress: '运行中',
};

export const APPROVAL_METHODS = {
  'item/commandExecution/requestApproval': '命令执行审批',
  'item/fileChange/requestApproval': '文件修改审批',
  'item/permissions/requestApproval': '权限申请',
  'item/tool/requestUserInput': '请求用户输入',
  'mcpServer/elicitation/request': 'MCP 请求',
};

export const DECISION_LABELS = {
  accept: '批准',
  acceptForSession: '批准（本会话都放行）',
  decline: '拒绝',
  cancel: '拒绝并中断',
  acceptWithExecpolicyAmendment: '批准并记住规则',
  applyNetworkPolicyAmendment: '应用网络策略',
};
