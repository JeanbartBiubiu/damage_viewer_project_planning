export type StatusRecordStatus = 'ENABLED' | 'DISABLED';

export type GameStatus = {
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
  statusKey: string;
  name: string;
  description: string | null;
  status: StatusRecordStatus;
  sortOrder: number;
};

export type UpdateStatusRequest = Omit<CreateStatusRequest, 'statusKey'>;
