/**
 * Hover tilt for [data-tilt] sheets.
 *
 * The sheet leans toward the pointer quickly, and when the pointer leaves it
 * eases back to rest slowly instead of snapping. It only rotates in place
 * (no lift toward the viewer), so a tilting sheet can never cut through a
 * neighbour.
 */
import { $$, finePointer } from '../lib/dom';
import { motion } from '../lib/motion';

const MAX_DEG = 4.5;
const FOLLOW = 11; // per second, while hovering
const RETURN = 1.9; // per second, on the way back to rest

function attach(node: HTMLElement): void {
  let goalX = 0;
  let goalY = 0;
  let x = 0;
  let y = 0;
  let hovering = false;
  let raf = 0;
  let last = 0;

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * (hovering ? FOLLOW : RETURN));
    x += (goalX - x) * k;
    y += (goalY - y) * k;

    if (!hovering && Math.abs(x) < 0.01 && Math.abs(y) < 0.01) {
      node.style.transform = '';
      node.style.removeProperty('--tilt-x');
      node.style.removeProperty('--tilt-y');
      raf = 0;
      return;
    }
    node.style.transform = `perspective(1100px) rotateX(${y.toFixed(3)}deg) rotateY(${x.toFixed(3)}deg)`;
    // lets a sheen follow the pointer in CSS
    node.style.setProperty('--tilt-x', (x / MAX_DEG).toFixed(3));
    node.style.setProperty('--tilt-y', (y / MAX_DEG).toFixed(3));
    raf = requestAnimationFrame(frame);
  };

  const run = (): void => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  node.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || motion.calm) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    goalX = px * 2 * MAX_DEG;
    goalY = -py * 2 * MAX_DEG;
    hovering = true;
    run();
  });

  node.addEventListener('pointerleave', () => {
    hovering = false;
    goalX = 0;
    goalY = 0;
    run();
  });
}

export function initTilt(): void {
  if (!finePointer()) return;
  $$('[data-tilt]').forEach(attach);
}
