/**
 * dsh-fairy-wake - Host half.
 *
 * The feature lives entirely in the browser half (client.js): microphone
 * capture, energy VAD, wake-word matching and composer insertion. This host
 * entry only exists so the Loader can mount the package; it contributes no
 * host service and registers no HTTP route.
 */
export const name = 'fairy-wake'

export function apply() {}
