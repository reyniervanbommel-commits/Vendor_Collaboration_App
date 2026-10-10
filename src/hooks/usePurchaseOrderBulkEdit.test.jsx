import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkWriteBackJobProvider, useBulkWriteBackJob } from '../context/BulkWriteBackJobContext';
import { usePurchaseOrderBulkEdit } from './usePurchaseOrderBulkEdit';

vi.mock('./useAppToast', () => ({
  useAppToast: () => ({
    notify: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
  }),
}));
vi.mock('../utils/api', () => ({ apiRequest: vi.fn() }));

const COLUMNS = [{ key: 'status', label: 'Status' }];
const ORDERS = [
  { dataAreaId: 'USMF', orderNumber: 'PO1', values: { status: 'Open' } },
  { dataAreaId: 'USMF', orderNumber: 'PO2', values: { status: 'Open' } },
  { dataAreaId: 'USMF', orderNumber: 'PO3', values: { status: 'Closed' } },
];

function makeSelection(selectedKeys) {
  const keys = new Set(selectedKeys);
  return { isSelected: (key) => keys.has(key) };
}

function wrapper({ children }) {
  return <BulkWriteBackJobProvider>{children}</BulkWriteBackJobProvider>;
}

function useCombined(props) {
  const bulk = usePurchaseOrderBulkEdit(props);
  const jobCtx = useBulkWriteBackJob();
  return { ...bulk, job: jobCtx.job, retryRow: jobCtx.retryRow, retryAllFailed: jobCtx.retryAllFailed };
}

function setup({ selectedKeys = ['USMF|PO1', 'USMF|PO2'], saveValue, correctField } = {}) {
  const resolvedSave = saveValue || vi.fn().mockResolvedValue();
  const resolvedCorrect = correctField || vi.fn().mockResolvedValue();
  const { result } = renderHook(() => useCombined({
    visibleHeaderColumns: COLUMNS,
    visibleOrders: ORDERS,
    selection: makeSelection(selectedKeys),
    saveValue: resolvedSave,
    correctField: resolvedCorrect,
  }), { wrapper });
  return { result, saveValue: resolvedSave, correctField: resolvedCorrect };
}

describe('usePurchaseOrderBulkEdit — geen dialoog nodig', () => {
  it('past een regel-cel (lineNumber gezet) altijd direct toe, zonder dialoog', async () => {
    const { result, saveValue } = setup();
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: 1, columnKey: 'qty', value: 5 };

    await act(async () => { await result.current.handleSaveValue(payload); });

    expect(saveValue).toHaveBeenCalledWith(payload);
    expect(result.current.dialogState.open).toBe(false);
  });

  it('past een header-cel direct toe zonder dialoog als er maar 1 rij geselecteerd is', async () => {
    const { result, saveValue } = setup({ selectedKeys: ['USMF|PO1'] });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    await act(async () => { await result.current.handleSaveValue(payload); });

    expect(saveValue).toHaveBeenCalledWith(payload);
    expect(result.current.dialogState.open).toBe(false);
  });

  it('past een header-cel direct toe als de bewerkte rij zelf niet in de selectie zit', async () => {
    const { result, saveValue } = setup({ selectedKeys: ['USMF|PO2', 'USMF|PO3'] });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    await act(async () => { await result.current.handleSaveValue(payload); });

    expect(saveValue).toHaveBeenCalledWith(payload);
  });
});

describe('usePurchaseOrderBulkEdit — bulk-beslissingsdialoog', () => {
  it('opent de dialoog bij een header-cel-wijziging op een multi-selectie', async () => {
    const { result } = setup();
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    act(() => { result.current.handleSaveValue(payload); });

    expect(result.current.dialogState).toMatchObject({
      open: true,
      mode: 'confirm',
      columnLabel: 'Status',
      selectedCount: 2,
    });
  });

  it('"single" past alleen de actieve cel toe en sluit de dialoog', async () => {
    const { result, saveValue } = setup();
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    let pending;
    act(() => { pending = result.current.handleSaveValue(payload); });
    act(() => result.current.dialogActions.onChooseSingleCell());
    await act(async () => { await pending; });

    expect(saveValue).toHaveBeenCalledTimes(1);
    expect(saveValue).toHaveBeenCalledWith(payload);
    expect(result.current.dialogState.open).toBe(false);
  });

  it('"bulk" past de wijziging toe op alle geselecteerde rijen, slaat rijen over die al gelijk zijn', async () => {
    const { result, saveValue } = setup({ selectedKeys: ['USMF|PO1', 'USMF|PO2'] });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Open' };

    let pending;
    act(() => { pending = result.current.handleSaveValue(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });

    expect(saveValue).not.toHaveBeenCalled();
    expect(result.current.dialogState.open).toBe(false);
  });

  it('"bulk" schrijft alleen rijen weg die daadwerkelijk wijzigen', async () => {
    const { result, saveValue } = setup({ selectedKeys: ['USMF|PO1', 'USMF|PO3'] });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    let pending;
    act(() => { pending = result.current.handleSaveValue(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });

    expect(saveValue).toHaveBeenCalledTimes(1);
    expect(saveValue).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO1', value: 'Closed' }));
  });

  it('handleCorrectField start een achtergrondjob en sluit de dialoog meteen', async () => {
    const { result, correctField, saveValue } = setup({ selectedKeys: ['USMF|PO1', 'USMF|PO3'] });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    let pending;
    act(() => { pending = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ background: true });
    expect(result.current.dialogState.open).toBe(false);
    expect(saveValue).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(correctField).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO1', basedOnValue: 'Open' }));
    });
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });

  it('stopt bij een fout, toont een samenvatting met updated/skipped/not-attempted en verwerpt de aanroep', async () => {
    const saveValue = vi.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('write failed'));
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2', 'USMF|PO3'],
      saveValue,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };

    let pending;
    act(() => { pending = result.current.handleSaveValue(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => {
      await expect(pending).rejects.toThrow(/Updated: 1/);
    });

    expect(result.current.dialogState.mode).toBe('summary');
    expect(result.current.dialogState.open).toBe(true);
    expect(result.current.dialogState.summaryMessage).toContain('Updated: 1');
  });

  it('sluiten van de confirm-dialoog (bv. Escape) telt als "single"', async () => {
    const { result, saveValue } = setup();
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Closed' };

    let pending;
    act(() => { pending = result.current.handleSaveValue(payload); });
    act(() => result.current.dialogActions.onOpenChange(false));
    await act(async () => { await pending; });

    expect(saveValue).toHaveBeenCalledTimes(1);
  });
});

describe('usePurchaseOrderBulkEdit — correct-pad achtergrondjob (#AB:295)', () => {
  it('gaat door na een fout op rij 2 van 3 en houdt failedRows in de job', async () => {
    const correctField = vi.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('conflict on PO2'))
      .mockResolvedValueOnce();
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2', 'USMF|PO3'],
      correctField,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };
    let pending;
    act(() => { pending = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });

    expect(result.current.dialogState.open).toBe(false);
    await waitFor(() => expect(correctField).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.job?.status).toBe('needsAttention'));
    expect(result.current.job.failedRows).toEqual([
      expect.objectContaining({ orderNumber: 'PO2', basedOnValue: 'Open', errorMessage: 'conflict on PO2' }),
    ]);
    expect(result.current.job.summaryMessage).toMatch(/Failed: 1/);
    expect(result.current.job.summaryMessage).toMatch(/Updated: 2/);
  });

  it('resolved zonder throw als de initiërende rij zelf faalt', async () => {
    const correctField = vi.fn()
      .mockRejectedValueOnce(new Error('locked PO1'))
      .mockResolvedValueOnce();
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2'],
      correctField,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };
    let pending;
    act(() => { pending = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });
    await waitFor(() => expect(result.current.job?.failedRows?.length).toBe(1));
    expect(result.current.job.failedRows).toEqual([
      expect.objectContaining({ orderNumber: 'PO1' }),
    ]);
  });

  it('houdt failedRows van andere rijen in de job, niet in de dialoog', async () => {
    const correctField = vi.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('locked PO2'));
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2'],
      correctField,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };
    let pending;
    act(() => { pending = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });
    await waitFor(() => expect(result.current.job?.failedRows?.[0]?.orderNumber).toBe('PO2'));
    expect(result.current.dialogState.open).toBe(false);
  });

  it('retryRow haalt een geslaagde rij uit de job', async () => {
    const correctField = vi.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('conflict on PO2'))
      .mockResolvedValueOnce();
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2'],
      correctField,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };
    let pending;
    act(() => { pending = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });
    await waitFor(() => expect(result.current.job?.failedRows).toHaveLength(1));

    await act(async () => { await result.current.retryRow('USMF|PO2'); });
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });

  it('weiger een tweede job zolang de eerste loopt', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const correctField = vi.fn(() => gate);
    const { result } = setup({
      selectedKeys: ['USMF|PO1', 'USMF|PO2'],
      correctField,
    });
    const payload = { dataAreaId: 'USMF', orderNumber: 'PO1', lineNumber: null, columnKey: 'status', value: 'Shipped' };

    let first;
    act(() => { first = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await first; });
    await waitFor(() => expect(result.current.job?.status).toBe('running'));

    let second;
    act(() => { second = result.current.handleCorrectField(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => {
      await expect(second).rejects.toThrow(/already running/);
    });

    await act(async () => { release(); });
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });
});

describe('usePurchaseOrderBulkEdit — gepushte header write-back', () => {
  const LINKED_COLUMNS = [{ key: 'colorValues', label: 'Color' }];
  const LINKED_ORDERS = [
    { dataAreaId: 'USMF', orderNumber: 'PO1', linkedLineValues: { colorValues: ['Red'] } },
    { dataAreaId: 'USMF', orderNumber: 'PO2', linkedLineValues: { colorValues: ['Red'] } },
    { dataAreaId: 'USMF', orderNumber: 'PO3', linkedLineValues: { colorValues: ['Blue', 'Green'] } },
  ];
  const PUSHED_PAYLOAD = {
    dataAreaId: 'USMF',
    orderNumber: 'PO1',
    headerColumnKey: 'colorValues',
    columnKey: 'colorValues',
    lineColumnId: 44,
    lineColumnKey: 'color',
    value: 'Green',
  };

  function setupLinked({ selectedKeys = ['USMF|PO1', 'USMF|PO2'] } = {}) {
    const correctAllLines = vi.fn().mockResolvedValue();
    const { result } = renderHook(() => useCombined({
      visibleHeaderColumns: LINKED_COLUMNS,
      visibleOrders: LINKED_ORDERS,
      selection: makeSelection(selectedKeys),
      saveValue: vi.fn(),
      correctField: vi.fn(),
      correctAllLines,
    }), { wrapper });
    return { result, correctAllLines };
  }

  it('opent de dialoog bij een gepushte header-cel op een multi-selectie', async () => {
    const { result } = setupLinked();

    act(() => { result.current.handleCorrectAllLines(PUSHED_PAYLOAD); });

    expect(result.current.dialogState).toMatchObject({
      open: true,
      mode: 'confirm',
      columnLabel: 'Color',
      selectedCount: 2,
    });
  });

  it('"single" start een achtergrondjob voor alleen de actieve order', async () => {
    const { result, correctAllLines } = setupLinked();

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(PUSHED_PAYLOAD); });
    act(() => result.current.dialogActions.onChooseSingleCell());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ background: true });
    expect(result.current.dialogState.open).toBe(false);
    await waitFor(() => {
      expect(correctAllLines).toHaveBeenCalledTimes(1);
    });
    expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({
      orderNumber: 'PO1',
      lineColumnId: 44,
      value: 'Green',
    }));
    expect(correctAllLines).not.toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO2' }));
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });

  it('"bulk" start een achtergrondjob voor elke geselecteerde order', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1', 'USMF|PO2', 'USMF|PO3'] });

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(PUSHED_PAYLOAD); });
    act(() => result.current.dialogActions.onChooseBulk());
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    expect(result.current.dialogState.open).toBe(false);
    expect(result.current.mixedConfirm.state.message)
      .toBe('1 of 3 selected orders have different line values. All their lines will be set to "Green" in D365.');
    act(() => result.current.mixedConfirm.actions.onConfirm());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ background: true });
    expect(result.current.dialogState.open).toBe(false);
    await waitFor(() => expect(correctAllLines).toHaveBeenCalledTimes(3));
    expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO1', value: 'Green' }));
    expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO2', value: 'Green' }));
    expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO3', value: 'Green' }));
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });

  it('"bulk" met afwijkende regelwaarden: Cancel in de bevestiging stuurt niets en start geen job', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1', 'USMF|PO2', 'USMF|PO3'] });

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(PUSHED_PAYLOAD); });
    act(() => result.current.dialogActions.onChooseBulk());
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));

    act(() => result.current.mixedConfirm.actions.onCancel());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ cancelled: true });
    expect(correctAllLines).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
    expect(result.current.dialogState.open).toBe(false);
  });

  it('"bulk" slaat een order over waarvan de unieke linked waarde al gelijk is', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1', 'USMF|PO2'] });
    const payload = { ...PUSHED_PAYLOAD, value: 'Red' };

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(payload); });
    act(() => result.current.dialogActions.onChooseBulk());
    await act(async () => { await pending; });

    expect(correctAllLines).not.toHaveBeenCalled();
  });

  it('vraagt bevestiging bij één order met afwijkende regelwaarden; Cancel stuurt niets', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO3'] });
    const payload = { ...PUSHED_PAYLOAD, orderNumber: 'PO3', value: 'Red' };

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(payload); });
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    expect(result.current.mixedConfirm.state.message)
      .toBe('Lines on order PO3 currently have 2 different values ("Blue", "Green"). All lines will be set to "Red" in D365.');

    act(() => result.current.mixedConfirm.actions.onCancel());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ cancelled: true });
    expect(result.current.mixedConfirm.state.open).toBe(false);
    expect(correctAllLines).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
  });

  it('"Update all lines" start de achtergrondjob voor de order', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO3'] });
    const payload = { ...PUSHED_PAYLOAD, orderNumber: 'PO3', value: 'Red' };

    let pending;
    act(() => { pending = result.current.handleCorrectAllLines(payload); });
    await waitFor(() => expect(result.current.mixedConfirm.state.open).toBe(true));
    act(() => result.current.mixedConfirm.actions.onConfirm());
    const returned = await act(async () => pending);

    expect(returned).toEqual({ background: true });
    await waitFor(() => expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'PO3', value: 'Red' })));
  });

  it('geen bevestiging als de order één unieke regelwaarde heeft', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1'] });

    const returned = await act(async () => result.current.handleCorrectAllLines(PUSHED_PAYLOAD));

    expect(returned).toEqual({ background: true });
    expect(result.current.mixedConfirm.state.open).toBe(false);
    await waitFor(() => expect(correctAllLines).toHaveBeenCalledTimes(1));
  });

  it('één PO zonder multi-select start ook een achtergrondjob', async () => {
    const { result, correctAllLines } = setupLinked({ selectedKeys: ['USMF|PO1'] });

    const returned = await act(async () => result.current.handleCorrectAllLines(PUSHED_PAYLOAD));

    expect(returned).toEqual({ background: true });
    expect(result.current.dialogState.open).toBe(false);
    await waitFor(() => {
      expect(correctAllLines).toHaveBeenCalledWith(expect.objectContaining({
        orderNumber: 'PO1',
        lineColumnId: 44,
        value: 'Green',
      }));
    });
    await waitFor(() => expect(result.current.job?.status).toBe('success'));
  });
});
