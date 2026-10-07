import { useCallback, useEffect, useMemo, useState } from 'react';

function dropPosition(event, axis) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (axis === 'y') return (event.clientY - rect.top) > (rect.height / 2) ? 'after' : 'before';
  return (event.clientX - rect.left) > (rect.width / 2) ? 'after' : 'before';
}

/** Native HTML5 drag-reorder. `axis` 'x' (columns, default) or 'y' (vertical lists). */
export function useColumnReorderDrag({ onReorder, disabled = false, axis = 'x' }) {
  const [draggingKey, setDraggingKey] = useState('');
  const [dropTarget, setDropTarget] = useState({ key: '', position: 'before' });
  const canDrag = !disabled && typeof onReorder === 'function';

  const resetDropTarget = useCallback(() => {
    setDropTarget((prev) => (prev.key ? { key: '', position: 'before' } : prev));
  }, []);

  const resetDragState = useCallback(() => {
    setDraggingKey('');
    resetDropTarget();
  }, [resetDropTarget]);

  useEffect(() => {
    if (!disabled) return undefined;
    resetDragState();
    return undefined;
  }, [disabled, resetDragState]);

  const handleDragStart = useCallback((event, columnKey) => {
    if (!canDrag) return;
    setDraggingKey(columnKey);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', columnKey);
  }, [canDrag]);

  const handleDragOver = useCallback((event, columnKey) => {
    if (!canDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = dropPosition(event, axis);
    setDropTarget((prev) => (prev.key === columnKey && prev.position === position ? prev : { key: columnKey, position }));
  }, [axis, canDrag]);

  const handleDragLeave = useCallback((event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    resetDropTarget();
  }, [resetDropTarget]);

  const handleDrop = useCallback(async (event, columnKey) => {
    event.preventDefault();
    const position = dropPosition(event, axis);
    const sourceKey = String(event.dataTransfer.getData('text/plain') || '');
    resetDragState();
    if (!canDrag) return;
    if (!sourceKey || sourceKey === columnKey) return;
    await onReorder(sourceKey, columnKey, position);
  }, [axis, canDrag, onReorder, resetDragState]);

  const handleDragEnd = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

  const getCellDragProps = useCallback((columnKey) => {
    if (!canDrag && !draggingKey) return {};
    return {
      draggable: canDrag,
      onDragStart: canDrag ? (event) => handleDragStart(event, columnKey) : undefined,
      onDragOver: canDrag ? (event) => handleDragOver(event, columnKey) : undefined,
      onDragLeave: canDrag ? handleDragLeave : undefined,
      onDrop: canDrag ? (event) => handleDrop(event, columnKey) : undefined,
      onDragEnd: handleDragEnd,
    };
  }, [canDrag, draggingKey, handleDragEnd, handleDragLeave, handleDragOver, handleDragStart, handleDrop]);

  return useMemo(() => ({
    canDrag,
    draggingKey,
    dropTargetKey: dropTarget.key,
    dropTargetPosition: dropTarget.position,
    getCellDragProps,
  }), [canDrag, draggingKey, dropTarget, getCellDragProps]);
}
