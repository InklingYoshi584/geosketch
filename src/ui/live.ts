/**
 * Chrome renders from the store subscription — and the store emits on *every*
 * pan and pinch frame (`setViewport`). A naive subscription therefore rebuilds
 * the action bar, the chip and the sheet dozens of times per second in the
 * middle of a gesture, replacing the very buttons a finger is aiming at.
 *
 * `live` collapses that: the caller derives a key from the state it renders,
 * and the DOM work happens only when that key changes. Panning and zooming
 * change no key, so the chrome stays put while the sketch moves under it.
 */
export function createLiveGate(): (key: string, render: () => void) => void {
  let last: string | undefined;
  return (key, render) => {
    if (key === last) return;
    last = key;
    render();
  };
}
