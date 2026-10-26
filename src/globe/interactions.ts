type PointerOptions = {
  // Positions the tooltip and receives it as a child.
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  // Picks the country under a client-space point, if any.
  countryAt: (clientX: number, clientY: number) => { id: string; name: string } | undefined;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string) => void;
};

const CLICK_TOLERANCE_PX = 5;
const HOVER_DELAY_MS = 50;
const SETTLE_DELAY_MS = 180;

// Hover and click on the globe surface, without scene raycasts.
// Hover work is throttled and paused while the camera moves; a drag never selects.
export function createPointerInteractions({
  container,
  canvas,
  countryAt,
  onHover,
  onSelect,
}: PointerOptions) {
  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip texture-tooltip';
  tooltip.hidden = true;
  container.appendChild(tooltip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: { x: number; y: number } | null = null;
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  const activePointers = new Set<number>();

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      showHover();
    }, delay);
  };
  const clearHover = () => {
    clearTimeout(timer);
    timer = undefined;
    tooltip.hidden = true;
    onHover(undefined);
  };
  const showHover = () => {
    if (!pointer || activePointers.size) return;
    const country = countryAt(pointer.x, pointer.y);
    onHover(country?.id);
    tooltip.hidden = !country;
    if (!country) return;
    const bounds = container.getBoundingClientRect();
    tooltip.textContent = country.name;
    const left = Math.min(pointer.x - bounds.left + 12, bounds.width - tooltip.offsetWidth - 8);
    const top = Math.min(pointer.y - bounds.top + 12, bounds.height - tooltip.offsetHeight - 8);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  };

  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (
      press &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE_PX
    ) {
      press.moved = true;
    }
    if (!timer) schedule(HOVER_DELAY_MS);
  };
  const down = (event: PointerEvent) => {
    activePointers.add(event.pointerId);
    press =
      event.button === 0 && activePointers.size === 1
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        : null;
    clearHover();
  };
  const up = (event: PointerEvent) => {
    activePointers.delete(event.pointerId);
    const click =
      event.type === 'pointerup' &&
      press?.id === event.pointerId &&
      !press.moved &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_TOLERANCE_PX;
    if (click) {
      const country = countryAt(event.clientX, event.clientY);
      if (country) onSelect(country.id);
    }
    press = null;
    pointer = { x: event.clientX, y: event.clientY };
    if (event.type === 'pointerup' && !timer) schedule(HOVER_DELAY_MS);
  };
  const leave = () => {
    pointer = null;
    clearHover();
  };

  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);

  return {
    // Camera movement hides hover until the view settles.
    cameraMoved() {
      clearHover();
      schedule(SETTLE_DELAY_MS);
    },
    dispose() {
      clearTimeout(timer);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      tooltip.remove();
    },
  };
}
