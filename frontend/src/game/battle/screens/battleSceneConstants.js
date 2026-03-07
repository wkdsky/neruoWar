export const TEAM_ATTACKER = 'attacker';
export const TEAM_DEFENDER = 'defender';

export const ORDER_MOVE = 'MOVE';
export const SPEED_MODE_B = 'B_HARMONIC';
export const SPEED_MODE_C = 'C_PER_TYPE';
export const SPEED_MODE_AUTO = 'AUTO';

export const CAMERA_ZOOM_STEP = 24;
export const CAMERA_DISTANCE_MIN = 360;
export const CAMERA_DISTANCE_MAX = 980;

export const DEPLOY_ROTATE_SENSITIVITY = 0.28;
export const DEPLOY_ROTATE_CLICK_THRESHOLD = 3;

// Keep attacker (world -X) on web-left when using pitch > 90 deg.
export const DEPLOY_DEFAULT_YAW_DEG = 0;
export const DEPLOY_DEFAULT_WORLD_YAW_DEG = 0;
export const DEPLOY_PITCH_DEG = 30;

export const BATTLE_PITCH_LOW_DEG = 40;
export const BATTLE_PITCH_HIGH_DEG = 90;
export const BATTLE_FOLLOW_YAW_DEG = 0;
export const BATTLE_FOLLOW_WORLD_YAW_DEG = 0;
export const BATTLE_FOLLOW_MIRROR_X = false;

export const BATTLE_UI_MODE_NONE = 'NONE';
export const BATTLE_UI_MODE_PATH = 'PATH_PLANNING';
export const BATTLE_UI_MODE_MARCH_PICK = 'MARCH_PICK';
export const BATTLE_UI_MODE_GUARD = 'GUARD';
export const BATTLE_UI_MODE_SKILL_PICK = 'SKILL_PICK';
export const BATTLE_UI_MODE_SKILL_CONFIRM = 'SKILL_CONFIRM';

export const QUICK_DEPLOY_TEAM_SHORTCUTS = [5, 10, 20, 30, 50];
export const QUICK_DEPLOY_TOTAL_SHORTCUTS = [
  { label: '5000', value: 5000 },
  { label: '1万', value: 10000 },
  { label: '5万', value: 50000 },
  { label: '10万', value: 100000 },
  { label: '20万', value: 200000 },
  { label: '30万', value: 300000 },
  { label: '50万', value: 500000 }
];
export const QUICK_DEPLOY_MAX_TEAM_COUNT = 200;
export const QUICK_DEPLOY_MAX_TOTAL = 500000;
export const QUICK_DEPLOY_RANDOM_DEFAULT = Object.freeze({
  attackerTeamCount: '10',
  defenderTeamCount: '10',
  attackerTotal: '10000',
  defenderTotal: '10000'
});
export const QUICK_DEPLOY_STANDARD_PRESETS = [
  {
    id: 'std_small',
    label: '小规模标准',
    desc: '双方 5 支部队，共 5000 人',
    attackerTeamCount: 5,
    defenderTeamCount: 5,
    attackerTotal: 5000,
    defenderTotal: 5000
  },
  {
    id: 'std_balanced',
    label: '均衡标准',
    desc: '双方 10 支部队，共 1 万人',
    attackerTeamCount: 10,
    defenderTeamCount: 10,
    attackerTotal: 10000,
    defenderTotal: 10000
  },
  {
    id: 'std_large',
    label: '大会战标准',
    desc: '双方 20 支部队，共 5 万人',
    attackerTeamCount: 20,
    defenderTeamCount: 20,
    attackerTotal: 50000,
    defenderTotal: 50000
  }
];

export const SPEED_MODE_CYCLE = [SPEED_MODE_B, SPEED_MODE_C, SPEED_MODE_AUTO];

export const speedModeLabel = (mode) => {
  if (mode === SPEED_MODE_C) return '撤退(C)';
  if (mode === SPEED_MODE_AUTO) return '自动(A)';
  return '行军(B)';
};

export const createDefaultAimState = () => ({
  active: false,
  squadId: '',
  classTag: '',
  point: null,
  radiusPx: 0
});

export const createDefaultPopupPos = () => ({ x: 120, y: 120 });

export const createDefaultResultState = () => ({
  open: false,
  submitting: false,
  error: '',
  summary: null,
  recorded: false
});

export const createDefaultDeployEditorDraft = () => ({ name: '', units: [] });

export const createDefaultDeployQuantityDialog = () => ({
  open: false,
  unitTypeId: '',
  unitName: '',
  max: 0,
  current: 1
});

export const createDefaultDeployDraggingGroup = () => ({
  groupId: '',
  team: TEAM_ATTACKER
});

export const createDefaultTemplateFillPreview = () => ({
  open: false,
  team: TEAM_ATTACKER,
  template: null,
  rows: [],
  totalRequested: 0,
  totalFilled: 0
});

export const createDefaultQuickDeployRandomForm = () => ({ ...QUICK_DEPLOY_RANDOM_DEFAULT });

export const createDefaultConfirmDeletePos = () => ({ x: 0, y: 0 });
