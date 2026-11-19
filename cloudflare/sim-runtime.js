import { initSync } from '../sim/pkg/botters_sim.js'
import wasm from './botters_sim_bg.wasm'
initSync({ module: wasm })
