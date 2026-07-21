export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copiedWithFallback = document.execCommand('copy');
      input.remove();
      if (!copiedWithFallback) return false;
    }
    return true;
  } catch {
    return false;
  }
}
