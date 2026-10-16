import { ConvexStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
export default createHandler(new ConvexStore(), { requireAccount: true, controlOnly: true })
