// A small read-only leaderboard projection keeps permanent Elo documents bounded.
export const boardNamespace = key => key === 'leaderboard' ? '' : key.endsWith(':leaderboard') ? key.slice(0, -'leaderboard'.length) : null
export const ratingKey = key => /^(.*)elo:([a-f0-9]{64})$/.exec(key)
export const rankPairs = pairs => pairs.sort((a, b) => b[1].rating - a[1].rating || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
