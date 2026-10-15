import { cronJobs, makeFunctionReference } from 'convex/server'
const crons = cronJobs()
crons.interval('expire transient records', { minutes: 1 }, makeFunctionReference('store:expire'))
export default crons
