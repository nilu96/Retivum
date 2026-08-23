function revealInputSelection(input: HTMLInputElement): void {
  if (document.activeElement !== input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === null || end === null) return;

  input.setSelectionRange(start, end, input.selectionDirection ?? 'none');

  const activeEdge = input.selectionDirection === 'backward' ? start : end;
  if (activeEdge === 0) input.scrollLeft = 0;
  else if (activeEdge === input.value.length) input.scrollLeft = input.scrollWidth;
}

export function keepInputSelectionVisible(
  input: HTMLInputElement,
): { destroy: () => void } {
  let settleFrame: number | undefined;
  let revealFrame: number | undefined;

  function cancelScheduledReveal(): void {
    if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    settleFrame = undefined;
    revealFrame = undefined;
  }

  function scheduleReveal(): void {
    cancelScheduledReveal();
    settleFrame = requestAnimationFrame(() => {
      settleFrame = undefined;
      revealFrame = requestAnimationFrame(() => {
        revealFrame = undefined;
        revealInputSelection(input);
      });
    });
  }

  input.addEventListener('focus', scheduleReveal);
  input.addEventListener('click', scheduleReveal);
  input.addEventListener('pointerup', scheduleReveal);
  input.addEventListener('keyup', scheduleReveal);

  return {
    destroy() {
      cancelScheduledReveal();
      input.removeEventListener('focus', scheduleReveal);
      input.removeEventListener('click', scheduleReveal);
      input.removeEventListener('pointerup', scheduleReveal);
      input.removeEventListener('keyup', scheduleReveal);
    },
  };
}
