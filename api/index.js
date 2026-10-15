import { RedisStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
export default createHandler(new RedisStore())
