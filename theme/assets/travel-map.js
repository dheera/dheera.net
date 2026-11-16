// Enhance the pre-rendered SVG. Geography and places are already in the HTML.
const root = document.querySelector('#travel-map');
if (root) {
  const canvas = root.querySelector('.travel-map-canvas');
  const svg = root.querySelector('svg');
  const viewport = root.querySelector('[data-map-viewport]');
  const label = root.querySelector('[data-map-label]');
  const status = root.querySelector('[data-map-selection]');
  const width = svg.viewBox.baseVal.width;
  const height = svg.viewBox.baseVal.height;
  const places = [...root.querySelectorAll('[data-map-place]')].map(element => ({
    element, id: element.dataset.mapPlace, name: element.dataset.placeName,
    x: Number(element.dataset.x), y: Number(element.dataset.y),
  }));
  const state = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let selected = null;
  let movement = 0;
  let gesture = null;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function screenPoint(x, y) {
    const point = svg.createSVGPoint();
    point.x = x; point.y = y;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function positionLabel() {
    if (!selected) { label.hidden = true; return; }
    const point = svg.createSVGPoint();
    point.x = state.x + selected.x * state.k;
    point.y = state.y + selected.y * state.k;
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) { label.hidden = true; return; }
    const screen = point.matrixTransform(svg.getScreenCTM());
    const bounds = canvas.getBoundingClientRect();
    label.hidden = false;
    label.style.left = `${clamp(screen.x - bounds.left - label.offsetWidth / 2, 8, bounds.width - label.offsetWidth - 8)}px`;
    const above = screen.y - bounds.top - label.offsetHeight - 13;
    label.style.top = `${above < 6 ? screen.y - bounds.top + 13 : above}px`;
  }

  function render() {
    state.k = clamp(state.k, 1, 8);
    state.x = clamp(state.x, width * (1 - state.k), 0);
    state.y = clamp(state.y, height * (1 - state.k), 0);
    viewport.setAttribute('transform', `translate(${state.x} ${state.y}) scale(${state.k})`);
    const unitsPerPixel = width / Math.max(1, svg.getBoundingClientRect().width);
    places.forEach(place => place.element.setAttribute('r', String((place === selected ? 4.2 : 2.5) * unitsPerPixel / state.k)));
    root.querySelector('[data-map-action="out"]').disabled = state.k <= 1;
    root.querySelector('[data-map-action="in"]').disabled = state.k >= 8;
    positionLabel();
  }

  function zoom(factor, anchor = { x: width / 2, y: height / 2 }) {
    const next = clamp(state.k * factor, 1, 8);
    const ratio = next / state.k;
    state.x = anchor.x - (anchor.x - state.x) * ratio;
    state.y = anchor.y - (anchor.y - state.y) * ratio;
    state.k = next;
    render();
  }

  function select(place) {
    selected?.element.classList.remove('is-selected');
    selected = place || null;
    selected?.element.classList.add('is-selected');
    label.textContent = status.textContent = selected?.name || '';
    render();
  }

  function reset() {
    Object.assign(state, { x: 0, y: 0, k: 1 });
    select(null);
  }

  function selectNearest(point) {
    const unitsPerPixel = width / Math.max(1, svg.getBoundingClientRect().width);
    let nearest = null, minimum = (17 * unitsPerPixel) ** 2;
    places.forEach(place => {
      const distance = (state.x + place.x * state.k - point.x) ** 2 + (state.y + place.y * state.k - point.y) ** 2;
      if (distance < minimum) { nearest = place; minimum = distance; }
    });
    select(nearest);
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  root.querySelectorAll('[data-map-controls]').forEach(element => { element.hidden = false; });
  canvas.dataset.interactive = 'true';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  root.querySelectorAll('[data-map-action]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.mapAction === 'reset') reset();
    else zoom(button.dataset.mapAction === 'in' ? 1.6 : 1 / 1.6);
  }));
  canvas.addEventListener('keydown', event => {
    if (['+', '='].includes(event.key)) zoom(1.6);
    else if (event.key === '-') zoom(1 / 1.6);
    else if (['0', 'Home'].includes(event.key)) reset();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      state.x += event.key === 'ArrowLeft' ? 70 : event.key === 'ArrowRight' ? -70 : 0;
      state.y += event.key === 'ArrowUp' ? 70 : event.key === 'ArrowDown' ? -70 : 0;
      render();
    } else return;
    event.preventDefault();
  });
  canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom(Math.exp(-event.deltaY * .004), screenPoint(event.clientX, event.clientY));
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, screenPoint(event.clientX, event.clientY));
    canvas.dataset.dragging = 'true';
    if (pointers.size === 1) { movement = 0; gesture = null; }
    else if (pointers.size === 2) { gesture = pinchState(); movement = 100; }
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const point = screenPoint(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    // Measure tap jitter in screen pixels, independently of the SVG's scale.
    movement += Math.hypot(point.x - previous.x, point.y - previous.y) * svg.getBoundingClientRect().width / width;
    if (pointers.size >= 2) {
      const next = pinchState();
      if (gesture) {
        state.x += next.x - gesture.x;
        state.y += next.y - gesture.y;
        zoom(next.distance / Math.max(1, gesture.distance), next);
      }
      gesture = next;
    } else {
      state.x += point.x - previous.x;
      state.y += point.y - previous.y;
      render();
    }
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    if (event.type === 'pointerup' && pointers.size === 1 && movement < 12) selectNearest(screenPoint(event.clientX, event.clientY));
    pointers.delete(event.pointerId);
    gesture = pointers.size >= 2 ? pinchState() : null;
    if (!pointers.size) delete canvas.dataset.dragging;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  new ResizeObserver(render).observe(canvas);
  render();
}
