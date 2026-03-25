import { Message } from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import type { LoadState } from '../../../../types/api';

export type CrudModalMode = 'create' | 'view' | 'edit';

type UseCrudResourcePageArgs<TRecord, TSearch, TForm> = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  createSearchData: () => TSearch;
  createFormData: () => TForm;
  listRecords: (apiBaseUrl: string, gameId: string, token: string) => Promise<TRecord[]>;
  saveRecord: (apiBaseUrl: string, gameId: string, token: string, formData: TForm) => Promise<TRecord>;
  filterRecords: (records: TRecord[], searchData: TSearch) => TRecord[];
  toFormData: (record: TRecord) => TForm;
  getSuccessMessage?: (mode: CrudModalMode) => string;
};

type UseCrudResourcePageResult<TRecord, TSearch, TForm> = {
  records: TRecord[];
  filteredRecords: TRecord[];
  recordsState: LoadState;
  recordsError: string | null;
  searchData: TSearch;
  modalVisible: boolean;
  modalMode: CrudModalMode;
  formData: TForm;
  saving: boolean;
  refreshRecords: () => void;
  updateSearchData: <K extends keyof TSearch>(field: K, value: TSearch[K]) => void;
  handleSearch: () => void;
  handleResetSearch: () => void;
  openCreateModal: () => void;
  openViewModal: (record: TRecord) => void;
  openEditModal: (record: TRecord) => void;
  closeModal: () => void;
  updateFormData: <K extends keyof TForm>(field: K, value: TForm[K]) => void;
  submitModal: () => Promise<void>;
};

export function useCrudResourcePage<TRecord, TSearch, TForm>({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  createSearchData,
  createFormData,
  listRecords,
  saveRecord,
  filterRecords,
  toFormData,
  getSuccessMessage
}: UseCrudResourcePageArgs<TRecord, TSearch, TForm>): UseCrudResourcePageResult<TRecord, TSearch, TForm> {
  const token = adminToken.trim();
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [records, setRecords] = useState<TRecord[]>([]);
  const [recordsState, setRecordsState] = useState<LoadState>('idle');
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [searchData, setSearchData] = useState<TSearch>(() => createSearchData());
  const [appliedSearchData, setAppliedSearchData] = useState<TSearch>(() => createSearchData());
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<CrudModalMode>('create');
  const [formData, setFormData] = useState<TForm>(() => createFormData());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedGameId || !token) {
      setRecords([]);
      setRecordsState('idle');
      setRecordsError(null);
      return;
    }

    let cancelled = false;
    const gameId = selectedGameId;

    async function loadRecords() {
      setRecordsState('loading');
      setRecordsError(null);

      try {
        const nextRecords = await listRecords(apiBaseUrl, gameId, token);
        if (cancelled) {
          return;
        }

        setRecords(nextRecords);
        setRecordsState('success');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRecords([]);
        setRecordsState('error');
        setRecordsError(getErrorMessage(error));
      }
    }

    void loadRecords();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, refreshSeed, selectedGameId, token]);

  const filteredRecords = useMemo(() => filterRecords(records, appliedSearchData), [appliedSearchData, records]);

  function openCreateModal() {
    setModalMode('create');
    setFormData(createFormData());
    setModalVisible(true);
  }

  function openViewModal(record: TRecord) {
    setModalMode('view');
    setFormData(toFormData(record));
    setModalVisible(true);
  }

  function openEditModal(record: TRecord) {
    setModalMode('edit');
    setFormData(toFormData(record));
    setModalVisible(true);
  }

  async function submitModal() {
    if (!selectedGameId || !token || modalMode === 'view') {
      return;
    }

    setSaving(true);
    try {
      await saveRecord(apiBaseUrl, selectedGameId, token, formData);
      Message.success(getSuccessMessage?.(modalMode) ?? '保存成功');
      setModalVisible(false);
      setRefreshSeed((value) => value + 1);
    } catch (error) {
      Message.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return {
    records,
    filteredRecords,
    recordsState,
    recordsError,
    searchData,
    modalVisible,
    modalMode,
    formData,
    saving,
    refreshRecords: () => setRefreshSeed((value) => value + 1),
    updateSearchData: (field, value) => setSearchData((current) => ({ ...current, [field]: value })),
    handleSearch: () => setAppliedSearchData({ ...searchData }),
    handleResetSearch: () => {
      const nextSearchData = createSearchData();
      setSearchData(nextSearchData);
      setAppliedSearchData(nextSearchData);
    },
    openCreateModal,
    openViewModal,
    openEditModal,
    closeModal: () => setModalVisible(false),
    updateFormData: (field, value) => setFormData((current) => ({ ...current, [field]: value })),
    submitModal
  };
}
