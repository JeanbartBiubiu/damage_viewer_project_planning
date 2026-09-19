export type StatusRecordStatus = 'ENABLED' | 'DISABLED';
export type StatusKind = 'STUN' | 'MOVEMENT_SLOW' | 'ROOT' | 'SILENCE' | 'CHARM';

export const STATUS_KIND_LABELS: Record<StatusKind, string> = {
  STUN: '眩晕',
  MOVEMENT_SLOW: '普通移动减速',
  ROOT: '禁锢',
  SILENCE: '沉默',
  CHARM: '魅惑'
};

export function isStatusKind(value: unknown): value is StatusKind {
  return value === 'STUN' || value === 'MOVEMENT_SLOW' || value === 'ROOT' || value === 'SILENCE' || value === 'CHARM';
}

export type GameStatus = {
  statusKind: StatusKind;
  gameId: string;
  statusKey: string;
  name: string;
  description: string | null;
  status: StatusRecordStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type StatusListResponse = {
  items: GameStatus[];
  total: number;
};

export type StatusListQuery = {
  keyword?: string;
  status?: StatusRecordStatus;
};

export type CreateStatusRequest = {
  statusKind: StatusKind;
  statusKey: string;
  name: string;
  description: string | null;
  status: StatusRecordStatus;
  sortOrder: number;
};

export type UpdateStatusRequest = Omit<CreateStatusRequest, 'statusKey'>;
