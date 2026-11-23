// Prompts given to the real agent. `default` is what a player types (guide.html) plus the headless start the bench needs.
export const BRIEFS = {
  default: ({ minutes }) => `Let's play Botters. Call join_match with vs "hard", minutes ${minutes}, planets 17, planning 20, and follow what it says. Play this one match to the end and try to win: keep calling wait_for_event until it reports the match is over, then stop.`,
}
